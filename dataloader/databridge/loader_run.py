"""The run log, app.loader_runs (0014_public_data.sql, 0030): each source's
runs, which the API's /v1/public-data/sources reads for freshness, the live
run reads to catch up daily sources, and the rate gate reads before asking
a server (utils/rate_gate.py)."""

from datetime import datetime

from databridge.base import Databridge
from model.loader_run import GateState, SourceHealth


class LoaderRunDatabridge(Databridge):
    async def record_run(self, *, source: str, target: str, status: str, started_at: datetime, fetched: int,
                         written: int, retired: int, detail: str, rate_limited: bool) -> None:
        await self._rows("loader_run_record", source=source, target=target, status=status, started_at=started_at,
                         fetched=fetched, written=written, retired=retired, detail=detail,
                         rate_limited=rate_limited)

    async def gate(self, source: str) -> GateState:
        return GateState(**await self._one("loader_run_gate", source=source))

    async def source_health(self) -> list[SourceHealth]:
        return [SourceHealth(**r) for r in await self._rows("loader_run_latest")]
