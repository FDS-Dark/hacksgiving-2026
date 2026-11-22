"""Stand-ins for the database and the sources, for unit tests."""

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from loader.base import (
    Cadence,
    Loader,
    OpportunityLoader,
    PublicDataLoader,
    ResourceLoader,
    Target,
)
from model.loader_run import GateState
from settings import LoaderConfig


def make_loader(name: str, items: Sequence[Any] = (), *, target: Target = Target.OPPORTUNITIES,
                error: Exception | None = None, missing: str | None = None, cadence: Cadence = Cadence.DAILY,
                tables: tuple[str, ...] = (), empty_is_valid: bool = False,
                min_interval: timedelta = timedelta(0), backoff: timedelta | None = None) -> Loader:
    """A source that lists `items` (or raises `error`). `fetches` counts how
    often it asked."""
    base: Any = {Target.OPPORTUNITIES: OpportunityLoader, Target.RESOURCES: ResourceLoader}.get(
        target, PublicDataLoader)

    class Fake(base):
        fetches = 0

        def missing(self, config: LoaderConfig) -> str | None:
            return missing

        def min_interval(self, config: LoaderConfig) -> timedelta:
            return min_interval

        def backoff(self, config: LoaderConfig) -> timedelta:
            return backoff if backoff is not None else super().backoff(config)

        async def fetch(self, config: LoaderConfig) -> Sequence[Any]:
            self.fetches += 1
            if error:
                raise error
            return list(items)

    Fake.name, Fake.target, Fake.description = name, target, name
    Fake.cadence, Fake.tables, Fake.empty_is_valid = cadence, tables, empty_is_valid
    return Fake()


class Runs:
    """app.loader_runs in memory: records runs, and answers the gate the way
    loader_run_gate does (0030)."""

    def __init__(self) -> None:
        self.recorded: list[dict[str, Any]] = []

    async def record_run(self, **run: Any) -> None:
        self.recorded.append(run)

    async def gate(self, source: str) -> GateState:
        mine = [r for r in self.recorded if r["source"] == source]
        attempts = [r["started_at"] for r in mine if r["status"] != "skipped"]
        limited = [r["started_at"] for r in mine if r["rate_limited"]]
        return GateState(last_attempt_at=max(attempts, default=None), last_rate_limited_at=max(limited, default=None))

    def attempt(self, source: str, started_at: datetime, *, status: str = "ok", rate_limited: bool = False) -> None:
        self.recorded.append({"source": source, "target": "signals", "status": status, "started_at": started_at,
                              "fetched": 0, "written": 0, "retired": 0, "detail": "", "rate_limited": rate_limited})
