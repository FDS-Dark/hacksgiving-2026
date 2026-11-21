"""The queue runner: claims jobs, runs their stage, and records the outcome.
It knows nothing about records; stages (services/pipeline.py) do.

One job, start to finish:
1. `job_claim` (one short transaction): the job is ours for `lease_seconds`,
   and the attempt is counted.
2. `stage.run(job)` with a timeout shorter than the lease. No transaction
   is open while it waits on an AI service.
3. Success: one transaction runs the stage's `finish` (save the result, move
   the record on, queue the next stage) and `job_complete`. If the lease was
   lost meanwhile, `job_complete` finds nothing and all of it rolls back;
   the new holder does the work instead. After the commit, `stage.after`
   cleans up (transcribe deletes the audio).
4. Failure: `job_fail` queues it again after an exponential backoff, or
   marks it dead when its attempts are used up, and then `stage.on_dead`
   tells the record. The error text kept is the exception's type (or a
   message the stage wrote to be safe), never the text being processed.

Run several replicas: SKIP LOCKED means no two take the same job.
"""

import asyncio
import logging
import random
import time
from collections.abc import Sequence

from databridge.executor import Transactions
from databridge.job import JobDatabridge
from models.job import Job, JobStatus
from services.extraction import ExtractionFailed
from services.transcription import TranscriptionFailed
from services.pipeline import Stage

logger = logging.getLogger(__name__)

# Exceptions whose message was written to be safe to store and show.
SAFE_MESSAGES: tuple[type[BaseException], ...] = (ExtractionFailed, TranscriptionFailed)


class LeaseLost(Exception):
    """job_complete found nothing: another worker holds the job now."""


def backoff_seconds(attempt: int, *, base: float = 5.0, cap: float = 600.0) -> int:
    """5s, 10s, 20s ... capped, with jitter so retries don't stampede."""
    delay = min(cap, base * 2 ** max(attempt - 1, 0))
    return int(delay * random.uniform(0.8, 1.2))


def error_text(error: BaseException) -> str:
    if isinstance(error, SAFE_MESSAGES):
        return str(error)[:500]
    if isinstance(error, TimeoutError):
        return "Timed out."
    return f"Failed ({type(error).__name__})."


class Runner:
    def __init__(
        self,
        jobs: JobDatabridge,
        transactions: Transactions,
        stages: Sequence[Stage],
        *,
        worker_id: str,
        concurrency: int = 4,
        lease_seconds: int = 120,
        idle_poll_seconds: float = 1.0,
        max_idle_poll_seconds: float = 5.0,
    ) -> None:
        self.jobs = jobs
        self.transactions = transactions
        self.stages = {stage.kind: stage for stage in stages}
        too_slow = [s.kind for s in stages if s.timeout >= lease_seconds - 5]
        if too_slow:
            raise ValueError(f"Stage timeouts must be shorter than the lease ({lease_seconds}s): {too_slow}")
        self.worker_id = worker_id
        self.concurrency = concurrency
        self.lease_seconds = lease_seconds
        self.idle_poll_seconds = idle_poll_seconds
        self.max_idle_poll_seconds = max_idle_poll_seconds
        self._running: set[asyncio.Task[None]] = set()
        # For the liveness probe: when the loop last went round.
        self.last_tick = time.monotonic()

    async def tick(self) -> int:
        """Claim as many jobs as there are free slots and start them.
        Returns how many were claimed."""
        self.last_tick = time.monotonic()
        free = self.concurrency - len(self._running)
        if free <= 0:
            return 0
        claimed = await self.jobs.claim(self.worker_id, list(self.stages), self.lease_seconds, free)
        for job in claimed:
            task = asyncio.create_task(self.process(job))
            self._running.add(task)
            task.add_done_callback(self._running.discard)
        return len(claimed)

    async def run(self, stop: asyncio.Event) -> None:
        """Poll until `stop` is set, backing off while the queue is empty,
        then wait for the jobs already started."""
        idle = self.idle_poll_seconds
        logger.info("Worker %s polling for %s", self.worker_id, ", ".join(self.stages))
        while not stop.is_set():
            try:
                claimed = await self.tick()
            except Exception:
                logger.exception("Claiming jobs failed; retrying")
                claimed = 0
            idle = self.idle_poll_seconds if claimed else min(idle * 1.5, self.max_idle_poll_seconds)
            try:
                await asyncio.wait_for(stop.wait(), timeout=0.05 if claimed else idle)
            except TimeoutError:
                pass
        await self.drain()

    async def drain(self) -> None:
        """Let started jobs finish (a redeploy sends SIGTERM first). Anything
        cut off by the pod's grace period is claimed again once its lease ends."""
        if self._running:
            logger.info("Waiting for %d running job(s)", len(self._running))
            await asyncio.gather(*self._running, return_exceptions=True)

    async def process(self, job: Job) -> None:
        stage = self.stages[job.kind]
        try:
            finish = await asyncio.wait_for(stage.run(job), timeout=stage.timeout)
            async with self.transactions.transaction() as tx:
                await finish(tx)
                if not await self.jobs.within(tx).complete(job.id, self.worker_id):
                    raise LeaseLost
            logger.info("Job %s (%s) done on attempt %d", job.id, job.kind, job.attempts)
            await self._after(stage, job)
        except LeaseLost:
            logger.warning("Job %s (%s): lease lost; its new holder finishes it", job.id, job.kind)
        except Exception as error:
            await self._failed(stage, job, error)

    async def _after(self, stage: Stage, job: Job) -> None:
        """Clean-up once the work is committed (deleting audio). A failure here
        doesn't undo the job; the sweeper catches what's left."""
        try:
            await stage.after(job)
        except Exception as error:
            logger.warning(
                "Job %s (%s): clean-up failed (%s); the sweeper will retry", job.id, job.kind, type(error).__name__
            )

    async def _failed(self, stage: Stage, job: Job, error: BaseException) -> None:
        message = error_text(error)
        logger.warning(
            "Job %s (%s) attempt %d/%d failed: %s", job.id, job.kind, job.attempts, job.max_attempts, message
        )
        try:
            # An error that says retrying can't fix it (`permanent`) dead-letters at once.
            give_up = bool(getattr(error, "permanent", False))
            now = await self.jobs.fail(job.id, self.worker_id, message, backoff_seconds(job.attempts), give_up=give_up)
            if now is not None and now.status == JobStatus.DEAD:
                logger.error("Job %s (%s) is dead after %d attempts", job.id, job.kind, job.attempts)
                await stage.on_dead(job)
        except Exception:
            # The lease will run out and the job will be claimed again.
            logger.exception("Couldn't record the failure of job %s", job.id)
