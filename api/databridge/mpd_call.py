import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from databridge.base import Databridge
from databridge.executor import Row


class MpdCallDatabridge(Databridge):
    async def upsert(self, calls: Sequence[dict[str, Any]]) -> int:
        """Stores a scrape; returns how many call numbers were new."""
        if not calls:
            return 0
        payload = json.dumps(list(calls), default=lambda v: v.isoformat() if isinstance(v, datetime) else str(v))
        row = await self._one("mpd_calls_upsert", calls=payload)
        return int(row["new_calls"] or 0)

    async def recent(self, hours: int, limit: int) -> list[Row]:
        return await self._rows("mpd_calls_recent", hours=hours, limit=limit)

    async def cached_geocodes(self, addresses: Sequence[str]) -> dict[str, tuple[float, float] | None]:
        if not addresses:
            return {}
        rows = await self._rows("mpd_geocode_lookup", addresses=list(addresses))
        return {
            row["address"]: (row["latitude"], row["longitude"]) if row["latitude"] is not None else None
            for row in rows
        }

    async def save_geocode(self, address: str, point: tuple[float, float] | None) -> None:
        lat, lng = point if point else (None, None)
        await self._rows("mpd_geocode_save", address=address, latitude=lat, longitude=lng)

    async def record_run(self, ok: bool, rows_seen: int, new_calls: int, error: str | None) -> None:
        await self._rows("mpd_ingest_record", ok=ok, rows_seen=rows_seen, new_calls=new_calls, error=error)

    async def status(self) -> Row:
        return await self._one("mpd_ingest_status")

    async def prune(self, keep_days: int) -> int:
        row = await self._one("mpd_calls_prune", keep_days=keep_days)
        return int(row["deleted"] or 0)
