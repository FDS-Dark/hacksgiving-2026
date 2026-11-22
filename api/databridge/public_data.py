"""The public-data tables (0014_public_data.sql): the generalized reads the
API serves. The data loader (dataloader/) writes them."""

import json
from datetime import datetime
from typing import Any

from databridge.base import Databridge
from databridge.executor import Row
from models.public_data import (
    CommunityMeasure,
    CrimeTrendPoint,
    DispatchCall,
    IncidentPoint,
    SourceHealth,
    TractCount,
    TransitAlert,
    TransitStop,
    WeatherAlert,
)


def _json(value: Any) -> Any:
    # asyncpg hands jsonb back as text unless a codec is set.
    return json.loads(value) if isinstance(value, str) else value


class PublicDataDatabridge(Databridge):
    async def areas(self, kind: str) -> list[Row]:
        """Boundaries of one kind, for placing cases (services/place.py)."""
        return [{**r, "geometry": _json(r["geometry"])} for r in await self._rows("geo_area_list", kind=kind)]

    async def incident_points(self, since: datetime, limit: int) -> list[IncidentPoint]:
        return [IncidentPoint(**r) for r in await self._rows("public_incident_points", since=since, limit=limit)]

    async def tract_counts(self, since: datetime, offense_code: str | None) -> list[TractCount]:
        rows = await self._rows("public_incident_tract_counts", since=since, offense_code=offense_code)
        return [TractCount(**r) for r in rows]

    async def calls(self, source: str | None, since: datetime, limit: int) -> list[DispatchCall]:
        rows = await self._rows("public_signal_list", source=source, since=since, limit=limit)
        return [DispatchCall(call_number=r.pop("external_id"), **r) for r in rows]

    async def stops_near(self, latitude: float, longitude: float, radius_m: float, limit: int) -> list[TransitStop]:
        rows = await self._rows("transit_stops_near", latitude=latitude, longitude=longitude, radius_m=radius_m,
                                limit=limit)
        return [TransitStop(**r) for r in rows]

    async def transit_alerts(self, routes: list[str] | None) -> list[TransitAlert]:
        rows = await self._rows("transit_alert_active", routes=routes)
        return [TransitAlert(id=r["external_id"], **{k: r[k] for k in (
            "header", "description", "effect", "url", "routes", "active_until")}) for r in rows]

    async def weather_alerts(self) -> list[WeatherAlert]:
        return [WeatherAlert(id=r["external_id"], **r) for r in await self._rows("weather_alert_active")]

    async def community_measures(self, tract_geoid: str | None, measure_id: str | None) -> list[CommunityMeasure]:
        rows = await self._rows("community_measure_list", tract_geoid=tract_geoid, measure_id=measure_id)
        return [CommunityMeasure(**r) for r in rows]

    async def crime_trends(self, offense: str | None) -> list[CrimeTrendPoint]:
        return [CrimeTrendPoint(**r) for r in await self._rows("crime_trend_list", offense=offense)]

    async def source_health(self) -> list[SourceHealth]:
        return [SourceHealth(**r) for r in await self._rows("loader_run_latest")]
