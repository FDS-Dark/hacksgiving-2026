"""Free text to a point, with the City of Milwaukee's own locator (the MPD
CAD locator the data loader also uses for dispatch calls). It places blocks
and intersections, even loosely written ones ("27th and Center", "Fond du
Lac & North"); it doesn't know neighborhood names or ZIP codes
(services/place.py matches neighborhoods itself).

Only a block or an intersection is ever sent: `street_query` cuts a house
number to its hundred block and drops unit numbers and lead-in words first.
Called only from services/place.py, in the worker.
"""

import re
from dataclasses import dataclass
from typing import Protocol

import httpx

USER_AGENT = "hacksgiving-api/1.0"
# MPD's own CAD locator: the one city locator that places intersections
# ("N 76TH ST/W GOOD HOPE RD") as well as addresses.
MPD_GEOCODER = (
    "https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPDTritech/TriTechLocator/GeocodeServer/"
    "findAddressCandidates"
)
MIN_SCORE = 85

# Milwaukee County, generously: a point outside is a geocoding error.
_BOUNDS = (42.8, 43.25, -88.1, -87.75)


def in_milwaukee(latitude: float | None, longitude: float | None) -> bool:
    if latitude is None or longitude is None:
        return False
    south, north, west, east = _BOUNDS
    return south <= latitude <= north and west <= longitude <= east


# Words that make text worth a locator lookup: a number (a block, a
# numbered street), an intersection, or a street type.
_STREETISH = re.compile(
    r"\d|&|/|\band\b|\b(st|street|ave?|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|"
    r"pkwy|parkway|hwy|highway|ter|terrace|way|cir|circle)\b",
    re.IGNORECASE,
)
_LEAD_IN = re.compile(
    r"^\s*(?:(?:right\s+|just\s+)?(?:near|outside|around|by|behind|across\s+from|in\s+front\s+of|next\s+to|"
    r"on\s+the\s+corner\s+of|corner\s+of|at|on|off)\b\s*)+(?:the\s+)?",
    re.IGNORECASE,
)
_UNIT = re.compile(r"[,\s]*\b(?:apt|apartment|unit|suite|ste|fl|floor|lot|rm|room)\b\.?\s*\S*|#\s*\S+", re.IGNORECASE)
_HOUSE_NUMBER = re.compile(r"\b(\d{3,6})(?=\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9])")


def street_query(text: str | None) -> str | None:
    """What to send the locator for a free-text location, or None when it
    names no street: "outside 2716 N 27th St Apt 4" -> "2700 N 27th St"."""
    if not text or not _STREETISH.search(text):
        return None
    query = _LEAD_IN.sub("", text.strip())
    query = _UNIT.sub("", query)
    query = _HOUSE_NUMBER.sub(lambda m: str(max(int(m.group(1)) // 100 * 100, 100)), query)
    query = re.sub(r"\s+", " ", query).strip(" ,.;:")
    return query[:120] or None


def tidy_address(address: str) -> str:
    """The locator's answer as a label: "N 27TH ST & W CENTER ST, Milwaukee,
    WI, 53210" -> "N 27th St & W Center St"."""
    street = address.split(",", 1)[0].strip()
    return " ".join(w if len(w) <= 1 or w.isdigit() else w[0] + w[1:].lower() for w in street.split())


@dataclass(frozen=True)
class GeocodedPoint:
    latitude: float
    longitude: float
    # The block or intersection the locator matched, tidied.
    label: str


class GeocoderError(Exception):
    """The lookup failed (network, an error answer): try again later.
    'No answer' is None, not an error."""


class Geocoder(Protocol):
    async def locate(self, query: str) -> GeocodedPoint | None: ...


class MilwaukeeGeocoder:
    def __init__(self, http: httpx.AsyncClient | None = None, timeout: float = 15.0) -> None:
        self.http = http or httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT})

    async def locate(self, query: str) -> GeocodedPoint | None:
        try:
            response = await self.http.get(
                MPD_GEOCODER, params={"SingleLine": query, "outSR": "4326", "maxLocations": "1", "f": "json"}
            )
        except httpx.HTTPError as exc:
            raise GeocoderError(f"The City locator failed: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise GeocoderError(f"The City locator answered {response.status_code}")
        try:
            body = response.json()
        except ValueError:
            raise GeocoderError("The City locator answered with something other than JSON") from None
        if not isinstance(body, dict) or "error" in body:
            raise GeocoderError("The City locator answered with an error")
        candidates = body.get("candidates") or []
        if not candidates or (candidates[0].get("score") or 0) < MIN_SCORE:
            return None
        best = candidates[0]
        location = best.get("location") or {}
        try:
            latitude, longitude = float(location["y"]), float(location["x"])
        except (KeyError, TypeError, ValueError):
            return None
        if not in_milwaukee(latitude, longitude):
            return None
        return GeocodedPoint(round(latitude, 3), round(longitude, 3), tidy_address(str(best.get("address") or query)))

    async def close(self) -> None:
        await self.http.aclose()
