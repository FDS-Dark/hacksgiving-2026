"""The public-data tables (0014_public_data.sql): bulk writes, removing what a
source stopped listing, and the boundaries incidents and calls are tagged
with."""

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from databridge.base import Databridge
from databridge.executor import Row
from model.public_data import (
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
