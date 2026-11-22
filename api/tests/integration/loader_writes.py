"""The writes the data loader makes (dataloader/databridge), for API tests
that need imported rows to read. They call the same stored functions
(0014_public_data.sql) with plain dicts; the loader's own tests cover how it
builds the rows."""

import json
from datetime import date, datetime
from typing import Any

from databridge.executor import FunctionCaller

# Each public-data table's bulk sync function.
SYNC = {
    "geo_areas": "geo_area_sync",
    "external_incidents": "external_incident_sync",
    "external_signals": "external_signal_sync",
    "transit_routes": "transit_route_sync",
    "transit_stops": "transit_stop_sync",
    "transit_alerts": "transit_alert_sync",
    "weather_alerts": "weather_alert_sync",
}


def _iso(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Can't send {type(value).__name__} as JSON")


async def sync(db: FunctionCaller, table: str, source: str, rows: list[dict[str, Any]],
               seen_at: datetime) -> tuple[int, int]:
    """(written, of which new), like the loader's bulk sync."""
    (row,) = await db.call(SYNC[table], {"source": source, "rows": json.dumps(rows, default=_iso),
                                         "seen_at": seen_at})
    return int(row["written"]), int(row["inserted"])


async def retire(db: FunctionCaller, table: str, source: str, seen_before: datetime,
                 window_start: datetime | None = None) -> int:
    (row,) = await db.call("public_data_retire", {"table": table, "source": source, "seen_before": seen_before,
                                                  "window_start": window_start})
    return int(row["retired"])


async def record_run(db: FunctionCaller, **run: Any) -> None:
    await db.call("loader_run_record", run)
