"""The two City of Milwaukee services the 911-call ingestion reads:

- the MPD calls-for-service page (server-rendered HTML, refreshed every five
  minutes), and
- MPD's own CAD geocoder (ArcGIS TriTechLocator), the one locator on
  milwaukeemaps.milwaukee.gov that places both street addresses and
  intersections like "N 76TH ST/W GOOD HOPE RD".

Network only; parsing and rules live in services/mpd_calls.py."""

from __future__ import annotations

import httpx

CALLS_URL = "https://itmdapps.milwaukee.gov/MPDCallData/index.jsp"
GEOCODER_URL = (
    "https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPDTritech/TriTechLocator/"
    "GeocodeServer/findAddressCandidates"
)
# Identify ourselves plainly; no contact details (see SECURITY.md).
USER_AGENT = "NearMKE-hackathon-ingest/0.1 (+public MPD call summary)"

# Anything outside this box is not a Milwaukee-area answer.
_BOUNDS = {"lat": (42.80, 43.25), "lng": (-88.15, -87.80)}
_MIN_SCORE = 85


class MpdSourceError(RuntimeError):
    """The MPD page or the geocoder answered with something unusable."""


class MpdClient:
    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(
            timeout=httpx.Timeout(20.0), headers={"User-Agent": USER_AGENT}, follow_redirects=True
        )

    async def fetch_calls_page(self) -> str:
        try:
            response = await self._http.get(CALLS_URL, params={"district": "All"}, headers={"Accept": "text/html"})
        except httpx.HTTPError as e:
            raise MpdSourceError(f"MPD calls page unreachable: {type(e).__name__}") from e
        if response.status_code != 200:
            raise MpdSourceError(f"MPD calls page answered {response.status_code}")
        return response.text

    async def geocode(self, address: str) -> tuple[float, float] | None:
        """(latitude, longitude) for a Milwaukee address or intersection, or
        None when the locator has no confident answer."""
        try:
            response = await self._http.get(GEOCODER_URL, params={
                "SingleLine": address, "outSR": "4326", "maxLocations": "1", "f": "json",
            })
            response.raise_for_status()
            candidates = response.json().get("candidates") or []
        except (httpx.HTTPError, ValueError) as e:
            raise MpdSourceError(f"Geocoder failed: {type(e).__name__}") from e
        if not candidates:
            return None
        best = candidates[0]
        location = best.get("location") or {}
        lat, lng = location.get("y"), location.get("x")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return None
        if (best.get("score") or 0) < _MIN_SCORE:
            return None
        if not (_BOUNDS["lat"][0] <= lat <= _BOUNDS["lat"][1] and _BOUNDS["lng"][0] <= lng <= _BOUNDS["lng"][1]):
            return None
        return float(lat), float(lng)

    async def aclose(self) -> None:
        await self._http.aclose()
