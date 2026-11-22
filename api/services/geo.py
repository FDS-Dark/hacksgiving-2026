"""Which area a point falls in: ray casting over GeoJSON polygons, with a
bounding-box check first. The database has no PostGIS, and a few hundred
areas against a few cases a round doesn't need it. (The data loader keeps
its own copy for tagging incidents with their tract: dataloader/client/geo.py.)"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

Ring = Sequence[Sequence[float]]


def _in_ring(lon: float, lat: float, ring: Ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_geometry(lon: float, lat: float, geometry: Mapping[str, Any]) -> bool:
    """Inside a Polygon or MultiPolygon: in an outer ring and none of its holes."""
    polygons = [geometry["coordinates"]] if geometry.get("type") == "Polygon" else geometry.get("coordinates", [])
    for polygon in polygons:
        if polygon and _in_ring(lon, lat, polygon[0]) and not any(_in_ring(lon, lat, h) for h in polygon[1:]):
            return True
    return False


@dataclass(frozen=True)
class Area:
    key: str
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float
    geometry: Mapping[str, Any]


class AreaIndex:
    def __init__(self, areas: Iterable[Area]) -> None:
        self.areas = list(areas)

    @classmethod
    def from_rows(cls, rows: Iterable[Mapping[str, Any]]) -> "AreaIndex":
        """From app.geo_area_list rows; the key is the id after the kind
        prefix ("census_tract:55079..." -> "55079...")."""
        return cls(
            Area(str(r["external_id"]).split(":", 1)[-1], r["min_lat"], r["min_lon"], r["max_lat"], r["max_lon"],
                 r["geometry"])
            for r in rows
        )

    def find(self, latitude: float | None, longitude: float | None) -> str | None:
        if latitude is None or longitude is None:
            return None
        for area in self.areas:
            if (area.min_lat <= latitude <= area.max_lat and area.min_lon <= longitude <= area.max_lon
                    and in_geometry(longitude, latitude, area.geometry)):
                return area.key
        return None
