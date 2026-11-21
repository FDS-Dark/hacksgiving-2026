import json
from datetime import datetime
from typing import Any
from uuid import UUID

from databridge.base import Databridge
from models.job import Job, JobStat


class JobDatabridge(Databridge):
    """The queue's stored functions (app.job_*). See database 0010 for how
    claiming, leases and dead-lettering work."""

    async def enqueue(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        run_at: datetime | None = None,
        max_attempts: int = 5,
        dedupe_key: str | None = None,
    ) -> Job:
        row = await self._one(
            "job_enqueue",
            kind=kind, payload=json.dumps(payload), run_at=run_at, max_attempts=max_attempts, dedupe_key=dedupe_key,
        )
        return Job(**row)

    async def claim(self, worker: str, kinds: list[str], lease_seconds: int, limit: int) -> list[Job]:
        rows = await self._rows("job_claim", worker=worker, kinds=kinds, lease_seconds=lease_seconds, limit=limit)
        return [Job(**row) for row in rows]

    async def heartbeat(self, job_id: UUID, worker: str, lease_seconds: int) -> bool:
        return await self._first("job_heartbeat", job_id=job_id, worker=worker, lease_seconds=lease_seconds) is not None

    async def complete(self, job_id: UUID, worker: str) -> bool:
        """False: this worker's lease ran out and someone else took the job."""
        return await self._first("job_complete", job_id=job_id, worker=worker) is not None

    async def fail(
        self, job_id: UUID, worker: str, error: str, retry_seconds: int, *, give_up: bool = False
    ) -> Job | None:
        """The job as it is now (queued again, or dead); None if the lease was
        lost. `give_up` dead-letters it at once (retrying can't help)."""
        row = await self._first(
            "job_fail", job_id=job_id, worker=worker, error=error, retry_seconds=retry_seconds, give_up=give_up
        )
        return Job(**row) if row else None

    async def stats(self) -> list[JobStat]:
        return [JobStat(**row) for row in await self._rows("job_stats")]

    async def prune(self, days: int) -> int:
        row = await self._one("job_prune", days=days)
        return int(row["deleted"])
