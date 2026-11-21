"""Runs MPD 911-call ingestion inside the API process, so nothing else has
to be started for calls to appear in the app.

The loop starts with the API (main.py's lifespan), ingests right away, then
every `interval_seconds`. With several API processes (replicas, or uvicorn
workers) each one runs the loop, but only the one that claims the database
lease (migration 0012) scrapes on a given tick. A failed tick is logged and
recorded; the loop carries on."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from adapters.mpd import MpdClient
from services.mpd_calls import MpdCallService

logger = logging.getLogger(__name__)


class MpdIngestLoop:
    def __init__(
        self,
        service: MpdCallService,
        interval_seconds: int,
        client_factory: Callable[[], MpdClient] = MpdClient,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.service = service
        self.interval = interval_seconds
        self._client_factory = client_factory
        self._sleep = sleep
        self._task: asyncio.Task[None] | None = None
        self._warned_schema = False

    async def tick(self, client: MpdClient) -> bool:
        """One scheduled run. True when this process ingested."""
        try:
            if not await self.service.calls.claim(self.interval):
                return False
        except Exception as e:
            # Usually the database hasn't been migrated yet; say so once.
            if not self._warned_schema:
                logger.warning("MPD ingest can't claim its lease (%s). Run database/migrate.sh.", type(e).__name__)
                self._warned_schema = True
            return False
        try:
            result = await self.service.ingest(client, client)
        except Exception:
            logger.exception("MPD ingest failed; retrying in %ss", self.interval)
            return True
        logger.info(
            "MPD ingest ok: %d rows, %d new, %d mapped, %d geocoded",
            result.rows_seen, result.new_calls, result.mapped, result.geocoded,
        )
        return True

    async def run(self) -> None:
        client = self._client_factory()
        try:
            while True:
                await self.tick(client)
                await self._sleep(self.interval)
        finally:
            await client.aclose()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run(), name="mpd-ingest")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
