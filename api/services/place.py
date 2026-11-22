"""Places cases on the map for Insights (app.case_places, 0020): a point,
the police district, census tract and neighborhood it falls in, and a
label safe for a dashboard. Runs in the worker's upkeep, a few cases a
round, so it covers every way a case comes in (the app, Ava, a debrief,
staff) without touching any of them.

For each case, in order:
  1. Its own coordinates (a resident who shared their location).
  2. A street or intersection in its location text, through the City's
     locator ("27th and Center"). Only the block is ever sent.
  3. A neighborhood named in it ("Sherman Park"), at the neighborhood's
     middle.
Otherwise it's `unplaced`, and tried again only if the location changes.
A locator that fails (rather than has no answer) leaves the case for the
next round.
"""

import logging
import re
import time
from collections.abc import Mapping, Sequence
from typing import Any

from adapters.geocoder import Geocoder, GeocoderError, street_query
from adapters.milwaukee import in_milwaukee
from databridge.place import PlaceDatabridge
from databridge.public_data import PublicDataDatabridge
from loader.geo import AreaIndex, in_geometry
from models.place import CasePlace, PendingPlace, PlaceSource, PlaceStatus

logger = logging.getLogger(__name__)

# The areas each place is tagged with: case_places column -> geo_areas kind.
AREA_KINDS = {"police_district": "police_district", "tract_geoid": "census_tract", "neighborhood": "neighborhood"}
# Boundaries change yearly at most; reload them every hour.
AREAS_TTL_SECONDS = 3600


def _words(text: str) -> str:
    """Lowercase words separated by single spaces, apostrophes dropped."""
    text = text.lower().replace("'", "").replace("’", "")
    return " " + " ".join(re.findall(r"[a-z0-9]+", text)) + " "


def _centroid(geometry: Mapping[str, Any]) -> tuple[float, float] | None:
    """A point inside the area: the average of its largest outer ring, or
    its bounding box's middle when that falls outside (a concave shape)."""
    polygons = [geometry["coordinates"]] if geometry.get("type") == "Polygon" else geometry.get("coordinates", [])
    rings: list[Sequence[Sequence[float]]] = [p[0] for p in polygons if p and p[0]]
    if not rings:
        return None
    ring = max(rings, key=len)
    lon = sum(p[0] for p in ring) / len(ring)
    lat = sum(p[1] for p in ring) / len(ring)
    if in_geometry(lon, lat, geometry):
        return lat, lon
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    middle = ((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)
    return middle if in_geometry(middle[1], middle[0], geometry) else (lat, lon)


def title(name: str) -> str:
    """'SHERMAN PARK' -> 'Sherman Park'."""
    return " ".join(w[0].upper() + w[1:].lower() if w else w for w in name.split(" "))


class Neighborhoods:
    """Neighborhood names, for matching free text against."""

    def __init__(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self.names: list[tuple[str, str, tuple[float, float]]] = []
        for row in rows:
            name = str(row["name"])
            middle = _centroid(row["geometry"])
            words = _words(name)
            if middle and len(words.strip()) >= 4:
                self.names.append((words, name, middle))
        # Longest first, so "Sherman Park West" beats "Sherman Park".
        self.names.sort(key=lambda n: -len(n[0]))

    def match(self, text: str) -> tuple[str, tuple[float, float]] | None:
        haystack = _words(text)
        for words, name, middle in self.names:
            if words in haystack:
                return name, middle
        return None


class CasePlacer:
    def __init__(
        self,
        places: PlaceDatabridge,
        areas: PublicDataDatabridge,
        geocoder: Geocoder | None,
        *,
        batch: int = 25,
        geocodes_per_round: int = 10,
    ) -> None:
        self.places = places
        self.areas = areas
        self.geocoder = geocoder
        self.batch = batch
        self.geocodes_per_round = geocodes_per_round
        self._indexes: dict[str, AreaIndex] = {}
        self._neighborhoods = Neighborhoods([])
        self._neighborhood_names: dict[str, str] = {}
        self._loaded_at = 0.0

    async def _load_areas(self) -> None:
        if self._indexes and time.monotonic() - self._loaded_at < AREAS_TTL_SECONDS:
            return
        indexes: dict[str, AreaIndex] = {}
        for column, kind in AREA_KINDS.items():
            rows = await self.areas.areas(kind)
            indexes[column] = AreaIndex.from_rows(rows)
            if kind == "neighborhood":
                self._neighborhoods = Neighborhoods(rows)
                self._neighborhood_names = {str(r["external_id"]).split(":", 1)[-1]: str(r["name"]) for r in rows}
        self._indexes = indexes
        self._loaded_at = time.monotonic()

    def _tag(self, case: PendingPlace, source: PlaceSource, lat: float, lon: float, label: str | None) -> CasePlace:
        areas = {column: index.find(lat, lon) for column, index in self._indexes.items()}
        neighborhood_name = self._neighborhood_name(areas["neighborhood"])
        return CasePlace(
            case_id=case.case_id, status=PlaceStatus.PLACED, source=source,
            latitude=round(lat, 3), longitude=round(lon, 3),
            label=label or (title(neighborhood_name) if neighborhood_name else None),
            police_district=areas["police_district"], tract_geoid=areas["tract_geoid"],
            neighborhood=neighborhood_name,
        )

    def _neighborhood_name(self, key: str | None) -> str | None:
        """geo_areas keys neighborhoods by id; patterns group by name."""
        return self._neighborhood_names.get(key, key) if key is not None else None

    async def place(self, case: PendingPlace, geocode_budget: list[int]) -> CasePlace | None:
        """The case's place; None when the locator failed (try again later)."""
        if in_milwaukee(case.latitude, case.longitude):
            assert case.latitude is not None and case.longitude is not None
            query = street_query(case.location)
            return self._tag(case, PlaceSource.CASE, case.latitude, case.longitude, query and title(query))
        text = (case.location or "").strip()
        query = street_query(text)
        if query and self.geocoder is not None and geocode_budget[0] > 0:
            geocode_budget[0] -= 1
            try:
                point = await self.geocoder.locate(query)
            except GeocoderError as error:
                logger.warning("Couldn't place case %s yet: %s", case.case_id, error)
                return None
            if point is not None:
                return self._tag(case, PlaceSource.GEOCODER, point.latitude, point.longitude, point.label)
        elif query and self.geocoder is not None:
            return None  # out of lookups this round; next round
        if text and (found := self._neighborhoods.match(text)):
            name, (lat, lon) = found
            placed = self._tag(case, PlaceSource.NEIGHBORHOOD, lat, lon, title(name))
            return placed.model_copy(update={"neighborhood": name})
        return CasePlace(case_id=case.case_id, status=PlaceStatus.UNPLACED)

    async def sweep(self) -> int:
        """Places up to `batch` pending cases. Returns how many were written."""
        pending = await self.places.pending(self.batch)
        if not pending:
            return 0
        await self._load_areas()
        budget = [self.geocodes_per_round]
        written = 0
        for case in pending:
            place = await self.place(case, budget)
            if place is not None and await self.places.save(place, case) is not None:
                written += 1
        return written
