"""The public-data tables (0014_public_data.sql): bulk writes for the loader,
and the generalized reads the API serves."""

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from databridge.base import Databridge
from databridge.executor import Row
from models.public_data import (
    CommunityMeasure,
    CrimeTrendPoint,
    DispatchCall,
    ImportedArea,
    ImportedCommunityMeasure,
    ImportedCrimeTrend,
    ImportedIncident,
    ImportedRow,
    ImportedSignal,
    ImportedTransitAlert,
    ImportedTransitRoute,
    ImportedTransitStop,
    ImportedWeatherAlert,
    IncidentPoint,
    SourceHealth,
    TractCount,
    TransitAlert,
    TransitStop,
    WeatherAlert,
)

# Each imported row type: its sync function and its table.
TABLES: dict[type[ImportedRow], tuple[str, str]] = {
    ImportedArea: ("geo_area_sync", "geo_areas"),
    ImportedIncident: ("external_incident_sync", "external_incidents"),
    ImportedSignal: ("external_signal_sync", "external_signals"),
    ImportedTransitRoute: ("transit_route_sync", "transit_routes"),
    ImportedTransitStop: ("transit_stop_sync", "transit_stops"),
    ImportedTransitAlert: ("transit_alert_sync", "transit_alerts"),
    ImportedWeatherAlert: ("weather_alert_sync", "weather_alerts"),
    ImportedCommunityMeasure: ("community_measure_sync", "community_measures"),
    ImportedCrimeTrend: ("crime_trend_sync", "crime_trends"),
}
_CHUNK = 2000


def _json(value: Any) -> Any:
    # asyncpg hands jsonb back as text unless a codec is set.
    return json.loads(value) if isinstance(value, str) else value


class PublicDataDatabridge(Databridge):
    # --- The loader -------------------------------------------------------------

    async def sync(self, source: str, rows: Sequence[ImportedRow], seen_at: datetime) -> tuple[int, int]:
        """Upserts `rows` (any mix of imported types) in chunks; returns
        (written, of which new)."""
        written = inserted = 0
        for row_type, (function, _) in TABLES.items():
            batch = [r.row() for r in rows if type(r) is row_type]
            for start in range(0, len(batch), _CHUNK):
                result = await self._one(function, source=source, rows=json.dumps(batch[start:start + _CHUNK]),
                                         seen_at=seen_at)
                written, inserted = written + int(result["written"]), inserted + int(result["inserted"])
        return written, inserted

    async def retire(self, table: str, source: str, seen_before: datetime,
                     window_start: datetime | None = None) -> int:
        row = await self._one("public_data_retire", table=table, source=source, seen_before=seen_before,
                              window_start=window_start)
        return int(row["retired"])

    async def areas(self, kind: str) -> list[Row]:
        return [{**r, "geometry": _json(r["geometry"])} for r in await self._rows("geo_area_list", kind=kind)]

    async def record_run(self, *, source: str, target: str, status: str, started_at: datetime, fetched: int,
                         written: int, retired: int, detail: str) -> None:
        await self._rows("loader_run_record", source=source, target=target, status=status, started_at=started_at,
                         fetched=fetched, written=written, retired=retired, detail=detail)

    # --- The API -------------------------------------------------------------------

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
