"""The job queue's guarantees, against real PostgreSQL as the app role. These
live in SQL (SKIP LOCKED, leases, owner checks), so fakes can't prove them."""

import asyncio
from uuid import uuid4

import pytest

from databridge.job import JobDatabridge
from models.job import JobStatus
from tests.integration.conftest import app_executor


@pytest.fixture
async def jobs(database):
    executor = app_executor(database)
    yield JobDatabridge(executor)
    await executor.dispose()


def _kind() -> str:
    # Each test uses its own kind, so tests sharing the database don't see
    # each other's jobs.
    return f"test.k{uuid4().hex[:10]}"


async def _expire(admin_conn, job_id) -> None:
    await admin_conn.execute("UPDATE app.jobs SET locked_until = now() - interval '1 second' WHERE id = $1", job_id)


async def test_two_workers_never_claim_the_same_job(jobs):
    kind = _kind()
    for _ in range(10):
        await jobs.enqueue(kind, {"n": 1})
    a, b = await asyncio.gather(jobs.claim("a", [kind], 60, 10), jobs.claim("b", [kind], 60, 10))
    ids_a, ids_b = {j.id for j in a}, {j.id for j in b}
    assert not ids_a & ids_b
    assert len(ids_a | ids_b) == 10


async def test_a_job_is_claimed_once_and_completed_by_its_holder(jobs):
    kind = _kind()
    job = await jobs.enqueue(kind, {"record_id": "x"})
    (claimed,) = await jobs.claim("w1", [kind], 60, 5)
    assert claimed.id == job.id and claimed.status == JobStatus.RUNNING and claimed.attempts == 1
    assert await jobs.claim("w2", [kind], 60, 5) == []
    assert await jobs.complete(job.id, "w2") is False  # not the holder
    assert await jobs.complete(job.id, "w1") is True


async def test_a_dead_workers_job_is_claimed_again_once_its_lease_runs_out(jobs, admin_conn):
    kind = _kind()
    job = await jobs.enqueue(kind, {})
    await jobs.claim("crashed", [kind], 60, 1)
    await _expire(admin_conn, job.id)
    (again,) = await jobs.claim("w2", [kind], 60, 1)
    assert again.id == job.id and again.locked_by == "w2" and again.attempts == 2
    # The crashed worker comes back: its complete and fail are ignored.
    assert await jobs.complete(job.id, "crashed") is False
    assert await jobs.fail(job.id, "crashed", "late", 0) is None
    assert await jobs.complete(job.id, "w2") is True


async def test_failures_retry_with_a_delay_then_dead_letter(jobs):
    kind = _kind()
    job = await jobs.enqueue(kind, {}, max_attempts=2)
    await jobs.claim("w", [kind], 60, 1)
    retried = await jobs.fail(job.id, "w", "Failed (TimeoutError).", 3600)
    assert retried is not None and retried.status == JobStatus.QUEUED
    assert await jobs.claim("w", [kind], 60, 1) == []  # not due for an hour


async def test_the_last_failed_attempt_is_dead(jobs, admin_conn):
    kind = _kind()
    job = await jobs.enqueue(kind, {}, max_attempts=2)
    await jobs.claim("w", [kind], 60, 1)
    await jobs.fail(job.id, "w", "first", 0)
    (second,) = await jobs.claim("w", [kind], 60, 1)
    assert second.attempts == 2
    dead = await jobs.fail(job.id, "w", "second", 0)
    assert dead is not None and dead.status == JobStatus.DEAD and dead.last_error == "second"
    assert await jobs.claim("w", [kind], 60, 1) == []


async def test_a_job_that_keeps_crashing_its_worker_still_ends_up_dead(jobs, admin_conn):
    kind = _kind()
    job = await jobs.enqueue(kind, {}, max_attempts=1)
    await jobs.claim("crashed", [kind], 60, 1)
    await _expire(admin_conn, job.id)
    assert await jobs.claim("w2", [kind], 60, 1) == []
    status = await admin_conn.fetchval("SELECT status FROM app.jobs WHERE id = $1", job.id)
    assert status == "dead"


async def test_enqueueing_the_same_work_twice_is_one_job(jobs):
    kind = _kind()
    first = await jobs.enqueue(kind, {}, dedupe_key=f"{kind}:1")
    second = await jobs.enqueue(kind, {}, dedupe_key=f"{kind}:1")
    assert first.id == second.id
    # Once it's done, the same key can queue new work.
    await jobs.claim("w", [kind], 60, 1)
    await jobs.complete(first.id, "w")
    third = await jobs.enqueue(kind, {}, dedupe_key=f"{kind}:1")
    assert third.id != first.id


async def test_stats_show_the_queue(jobs):
    kind = _kind()
    await jobs.enqueue(kind, {})
    stats = {(s.kind, s.status): s.total for s in await jobs.stats()}
    assert stats[(kind, JobStatus.QUEUED)] == 1


async def test_an_error_retrying_cant_fix_is_dead_at_once(jobs):
    kind = _kind()
    job = await jobs.enqueue(kind, {}, max_attempts=5)
    await jobs.claim("w", [kind], 60, 1)
    dead = await jobs.fail(job.id, "w", "The recording couldn't be read.", 30, give_up=True)
    assert dead is not None and dead.status == JobStatus.DEAD and dead.attempts == 1
