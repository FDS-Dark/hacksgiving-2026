"""Case places (0020_case_places.sql), for the worker's placer."""

from databridge.base import Databridge
from models.place import CasePlace, PendingPlace


class PlaceDatabridge(Databridge):
    async def pending(self, limit: int) -> list[PendingPlace]:
        return [PendingPlace(**row) for row in await self._rows("case_place_pending", limit=limit)]

    async def save(self, place: CasePlace, seen: PendingPlace) -> CasePlace | None:
        """None when the case is gone."""
        row = await self._first(
            "case_place_save",
            case_id=place.case_id, status=place.status, source=place.source,
            latitude=place.latitude, longitude=place.longitude, label=place.label,
            police_district=place.police_district, tract_geoid=place.tract_geoid,
            neighborhood=place.neighborhood, seen_location=seen.location,
            seen_latitude=seen.latitude, seen_longitude=seen.longitude,
        )
        return CasePlace(**row) if row else None
