"""City of Milwaukee public data (docs/real-data-sources.md):

* NIBRS reviewed incidents from the open data portal (CKAN, CC BY)
* MPD and MFD dispatched calls, parsed from their public pages
* official boundaries from the City's ArcGIS server

Every location is generalized before it leaves this module: no address is
kept, and coordinates are rounded (the database rounds them again). Parsing
is separate from fetching, so tests run on recorded payloads.
"""

import html
import re
from collections.abc import Iterator, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from models.public_data import ImportedArea, ImportedIncident, ImportedSignal

USER_AGENT = "hacksgiving-data-loader/1.0"
CHICAGO = ZoneInfo("America/Chicago")

NIBRS_SOURCE = "mke_nibrs"
MPD_CALLS_SOURCE = "mpd_calls"
MFD_CALLS_SOURCE = "mfd_calls"
BOUNDARIES_SOURCE = "mke_boundaries"

CKAN_SQL = "https://data.milwaukee.gov/api/3/action/datastore_search_sql"
NIBRS_RESOURCE = "87843297-a6fa-46d4-ba5d-cb342fb2d3bb"
MPD_CALLS_URL = "https://itmdapps.milwaukee.gov/MPDCallData/"
MFD_CALLS_URL = "https://itmdapps.milwaukee.gov/MFDCallData/index.jsp"
ARCGIS = "https://milwaukeemaps.milwaukee.gov/arcgis/rest/services"

# (kind, layer path, id field, name field)
BOUNDARIES = (
    ("police_district", "MPD/MPD_geography/MapServer/2", "POLICE", "POLICE"),
    ("census_tract", "census/Census2020/MapServer/0", "GEOID", "NAME"),
    ("neighborhood", "AGO/neighborhoods/MapServer/0", "NBHD_ID", "NEIGHBORHD"),
    ("aldermanic_district", "election/election_geography/MapServer/1", "DISTRICT", "DISTRICT_LABEL"),
)

# Milwaukee County, generously: a point outside is a geocoding error.
_BOUNDS = (42.8, 43.25, -88.1, -87.75)
_PAGE = 5000
_COORDINATES = re.compile(r"LL\(([-\d:.]+),([-\d:.]+)\)", re.IGNORECASE)

# Dispatch call types never shown publicly (docs/real-data-sources.md).
_SENSITIVE = (
    "domestic", "sexual", "sex offense", "rape", "suicide", "self harm", "self-harm", "overdose", "traffick",
    "juvenile", "child", "welfare", "missing", "runaway", "mental", "emotionally disturbed", "elder abuse",
)


class MilwaukeeDataError(RuntimeError):
    """A failed request or a page that no longer looks the way we parse it."""


def client(timeout: float, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT}, transport=transport,
                             follow_redirects=True)


async def _get(http: httpx.AsyncClient, url: str, **params: Any) -> httpx.Response:
    try:
        response = await http.get(url, params=params or None)
    except httpx.HTTPError as exc:
        raise MilwaukeeDataError(f"Request to {httpx.URL(url).host} failed: {type(exc).__name__}") from None
    if response.status_code != 200:
        raise MilwaukeeDataError(f"{httpx.URL(url).host} answered {response.status_code}")
    return response


def in_milwaukee(latitude: float | None, longitude: float | None) -> bool:
    if latitude is None or longitude is None:
        return False
    south, north, west, east = _BOUNDS
    return south <= latitude <= north and west <= longitude <= east


def _local(value: str, fmt: str) -> datetime | None:
    try:
        return datetime.strptime(value.strip(), fmt).replace(tzinfo=CHICAGO)
    except (ValueError, AttributeError):
        return None


def _float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _codes(value: Any) -> list[str]:
    return [c.strip() for c in str(value or "").split(";") if c.strip()]


# --- NIBRS -----------------------------------------------------------------------


async def fetch_incidents(
    http: httpx.AsyncClient, *, since: datetime, now: datetime, limit: int
) -> list[ImportedIncident]:
    """Incidents on or after `since`, newest first, through the portal's SQL
    endpoint (paged). A CKAN error envelope fails the fetch."""
    found: list[ImportedIncident] = []
    offset = 0
    day = since.astimezone(CHICAGO).strftime("%Y-%m-%d")
    while len(found) < limit:
        sql = (
            'SELECT "Case_Number", "Incident_Date", "Offense_Last_Edited", "Police_District", "Offense_All", '
            f'"Address_Longitude", "Address_Latitude", "Weapon_Used_All" FROM "{NIBRS_RESOURCE}" '
            f"WHERE \"Incident_Date\" >= '{day}' ORDER BY \"Incident_Date\" DESC LIMIT {_PAGE} OFFSET {offset}"
        )
        body = (await _get(http, CKAN_SQL, sql=sql)).json()
        if not body.get("success"):
            raise MilwaukeeDataError("The open data portal returned an error")
        records = body["result"]["records"]
        found.extend(parse_incidents(records, now))
        if len(records) < _PAGE:
            break
        offset += _PAGE
    return found[:limit]


def parse_incidents(records: list[Mapping[str, Any]], now: datetime) -> Iterator[ImportedIncident]:
    """Rows without a case number or a readable date are skipped, and so are
    dates in the future (the source has at least one): they're typos.
    Coordinates outside Milwaukee are dropped; the record stays."""
    latest = now + timedelta(days=1)
    for record in records:
        case = str(record.get("Case_Number") or "").strip()
        incident_at = _local(str(record.get("Incident_Date") or ""), "%Y-%m-%d %H:%M:%S")
        if not case or incident_at is None or incident_at > latest:
            continue
        latitude, longitude = _float(record.get("Address_Latitude")), _float(record.get("Address_Longitude"))
        located = in_milwaukee(latitude, longitude)
        yield ImportedIncident(
            external_id=case,
            incident_at=incident_at,
            last_edited_at=_local(str(record.get("Offense_Last_Edited") or ""), "%Y-%m-%d %H:%M:%S"),
            district=str(record.get("Police_District") or "").strip() or None,
            latitude=round(latitude, 3) if located and latitude is not None else None,
            longitude=round(longitude, 3) if located and longitude is not None else None,
            offense_codes=_codes(record.get("Offense_All")),
            weapons=_codes(record.get("Weapon_Used_All")),
        )


# --- Dispatch calls -----------------------------------------------------------------

_ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_CELL = re.compile(r"<t([dh])\b[^>]*>(.*?)</t[dh]>", re.IGNORECASE | re.DOTALL)
_TAG = re.compile(r"<[^>]+>")

MPD_COLUMNS = ["Call Number", "Date/Time", "Location", "Police District", "Nature of Call", "Status"]
MFD_COLUMNS = ["CFS", "Date/Time", "Address", "City", "Nature of Call", "Disposition"]


def _text(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", cell))).strip()


def _table(page: str, columns: list[str]) -> Iterator[list[str]]:
    """The data rows of the calls table. Raises when its header isn't the
    one we parse (the page changed shape), rather than misreading it."""
    header_seen = False
    for row in _ROW.findall(page):
        cells = _CELL.findall(row)
        texts = [_text(c) for _, c in cells]
        if cells and all(kind.lower() == "h" for kind, _ in cells):
            if texts == columns:
                header_seen = True
            continue
        if header_seen and len(texts) == len(columns):
            yield texts
    if not header_seen:
        raise MilwaukeeDataError(f"The calls page no longer has the columns {', '.join(columns)}")


def _dms(value: str) -> float | None:
    try:
        degrees, minutes, seconds = (float(p) for p in value.split(":"))
    except ValueError:
        return None
    sign = -1 if degrees < 0 else 1
    return sign * (abs(degrees) + minutes / 60 + seconds / 3600)


def is_public(category: str) -> bool:
    lowered = category.lower()
    return not any(term in lowered for term in _SENSITIVE)


def parse_mpd_calls(page: str, ttl: timedelta) -> Iterator[ImportedSignal]:
    """MPD calls. The location is read only for its embedded coordinates
    (rounded to about 110 m); the address itself is dropped."""
    for number, when, location, district, nature, status in _table(page, MPD_COLUMNS):
        if "unreasonable amount of requests" in nature.lower():
            # The page allows 10 requests per 30 minutes per address and
            # answers with this row instead of the calls.
            raise MilwaukeeDataError("MPD's calls page is rate limiting this address (10 requests per 30 minutes)")
        occurred_at = _local(when, "%m/%d/%Y %I:%M %p")
        if not re.fullmatch(r"P\d+", number) or occurred_at is None or not nature:
            continue
        latitude = longitude = None
        if match := _COORDINATES.search(location):
            longitude, latitude = _dms(match.group(1)), _dms(match.group(2))
            if not in_milwaukee(latitude, longitude):
                latitude = longitude = None
        yield ImportedSignal(
            external_id=number,
            occurred_at=occurred_at,
            category=nature,
            status=status or None,
            district=district or None,
            latitude=round(latitude, 3) if latitude is not None else None,
            longitude=round(longitude, 3) if longitude is not None else None,
            public=is_public(nature),
            expires_at=occurred_at + ttl,
        )


def parse_mfd_calls(page: str, ttl: timedelta) -> Iterator[ImportedSignal]:
    """MFD calls: fire, EMS and rescue context. Only the city is kept."""
    for number, when, _address, city, nature, disposition in _table(page, MFD_COLUMNS):
        occurred_at = _local(when, "%Y-%m-%d %H:%M:%S")
        if not re.fullmatch(r"F\d+", number) or occurred_at is None or not nature:
            continue
        yield ImportedSignal(
            external_id=number,
            occurred_at=occurred_at,
            category=nature,
            status=disposition or None,
            city=city or None,
            public=is_public(nature),
            expires_at=occurred_at + ttl,
        )


async def fetch_mpd_calls(http: httpx.AsyncClient, *, ttl: timedelta) -> list[ImportedSignal]:
    return list(parse_mpd_calls((await _get(http, MPD_CALLS_URL)).text, ttl))


async def fetch_mfd_calls(http: httpx.AsyncClient, *, ttl: timedelta) -> list[ImportedSignal]:
    return list(parse_mfd_calls((await _get(http, MFD_CALLS_URL)).text, ttl))


# --- Boundaries -----------------------------------------------------------------------


async def fetch_boundaries(http: httpx.AsyncClient) -> list[ImportedArea]:
    areas: list[ImportedArea] = []
    for kind, layer, id_field, name_field in BOUNDARIES:
        body = (await _get(http, f"{ARCGIS}/{layer}/query", where="1=1", outFields="*", returnGeometry="true",
                           outSR="4326", f="geojson")).json()
        areas.extend(parse_boundaries(body, kind, id_field, name_field))
    return areas


def parse_boundaries(body: Mapping[str, Any], kind: str, id_field: str, name_field: str) -> Iterator[ImportedArea]:
    """GeoJSON polygons, with their bounding boxes. ArcGIS reports errors in
    a 200 response, and truncates large results; both fail the fetch."""
    if "error" in body:
        raise MilwaukeeDataError(f"The map server returned an error for {kind}")
    if body.get("exceededTransferLimit"):
        raise MilwaukeeDataError(f"The map server truncated {kind}")
    for feature in body.get("features") or []:
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        key = properties.get(id_field)
        if geometry.get("type") not in ("Polygon", "MultiPolygon") or key in (None, ""):
            continue
        points = list(_points(geometry))
        if not points:
            continue
        lons, lats = [p[0] for p in points], [p[1] for p in points]
        yield ImportedArea(
            external_id=f"{kind}:{key}",
            kind=kind,
            name=str(properties.get(name_field) or key),
            properties={k: v for k, v in properties.items() if isinstance(v, (str, int, float)) and k != "OBJECTID"},
            geometry=geometry,
            min_lat=min(lats), max_lat=max(lats), min_lon=min(lons), max_lon=max(lons),
        )


def _points(geometry: Mapping[str, Any]) -> Iterator[tuple[float, float]]:
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        for ring in polygon:
            for point in ring:
                yield float(point[0]), float(point[1])
