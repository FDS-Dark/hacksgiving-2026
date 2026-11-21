"""Background jobs (app.jobs): durable, retried, leased work for the worker
process (worker/). Payloads carry ids only, never the text being processed."""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from models.base import ApiModel


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    DEAD = "dead"


class Job(ApiModel):
    id: UUID
    kind: str
    payload: dict[str, Any]
    status: JobStatus
    attempts: int
    max_attempts: int
    run_at: datetime
    locked_by: str | None
    locked_until: datetime | None
    last_error: str | None
    dedupe_key: str | None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class JobStat(ApiModel):
    """One kind and status in the queue: how many, and the oldest one due."""

    kind: str
    status: JobStatus
    total: int
    oldest_run_at: datetime | None
