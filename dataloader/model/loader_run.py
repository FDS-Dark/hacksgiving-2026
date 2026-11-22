"""What app.loader_runs says about a source (0014_public_data.sql, 0030)."""

from datetime import datetime

from pydantic import BaseModel


class SourceHealth(BaseModel):
    """A source's latest run, and when it last succeeded (loader_run_latest).
    The live run catches up daily sources from these (loader/schedule.py)."""

    source: str
    target: str
    status: str
    finished_at: datetime
    fetched: int
    detail: str
    last_success_at: datetime | None = None


class GateState(BaseModel):
    """When a source last asked its server for data (loader_run_gate): its
    last attempt, successful or not, and its last attempt the server refused
    for asking too often. Skipped runs don't count."""

    last_attempt_at: datetime | None = None
    last_rate_limited_at: datetime | None = None
