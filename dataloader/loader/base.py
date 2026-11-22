"""The Loader base class: one subclass per source (loader/sources.py lists
them in run order).

A loader says what it is (name, target, cadence, the tables it owns), what
it needs (`missing`), how often it may ask its server (`min_interval`,
`backoff`), and how to `fetch`. Its base class (`OpportunityLoader`,
`ResourceLoader` or `PublicDataLoader`) knows how to `write`. `run` wraps
them:

    credentials -> rate gate -> fetch -> write -> record the run

Each source runs on its own: one that fails is reported and the rest still
run. A source only removes the rows it no longer lists after a complete,
clean run: a fetch error, a row that failed to write, or an empty result
(more likely a broken source than an empty city) removes nothing. Alert
feeds are the exception: an empty feed means there are no alerts. Every run
that asked a server, and every skip for missing credentials, is recorded
in app.loader_runs, so the app can show each source's freshness and the
rate gate can see each source's last attempt.
"""

import logging
import re
from abc import ABC, abstractmethod
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, ClassVar, Protocol

from client.errors import RateLimited
from client.geo import AreaIndex
from model.imported import ImportedOpportunity, ImportedResource, SyncResult
from model.loader_run import GateState
from model.public_data import ImportedIncident, ImportedRow, ImportedSignal
from settings import LoaderConfig
from utils import rate_gate

logger = logging.getLogger("loader")


class Target(StrEnum):
    OPPORTUNITIES = "opportunities"
    RESOURCES = "resources"
    AREAS = "areas"
    INCIDENTS = "incidents"
    SIGNALS = "signals"
    TRANSIT = "transit"
    WEATHER = "weather"
    COMMUNITY = "community"
    CRIME = "crime"


class Cadence(StrEnum):
    DAILY = "daily"
    LIVE = "live"


class Status(StrEnum):
    OK = "ok"
    SKIPPED = "skipped"  # missing credentials, or held back by the rate gate
    FAILED = "failed"
    DRY_RUN = "dry_run"


Fetched = Sequence[Any]

# How long a source that was told it asked too often waits, unless it says
# otherwise.
DEFAULT_BACKOFF = timedelta(minutes=30)


class OpportunitySink(Protocol):
    async def sync_upsert(self, item: ImportedOpportunity, seen_at: datetime) -> SyncResult: ...
    async def sync_retire(self, source: str, seen_before: datetime) -> int: ...


class ResourceSink(Protocol):
    async def sync_upsert(self, item: ImportedResource, seen_at: datetime) -> SyncResult: ...
    async def sync_retire(self, source: str, seen_before: datetime) -> int: ...


class PublicDataSink(Protocol):
    async def sync(self, source: str, rows: Sequence[ImportedRow], seen_at: datetime) -> tuple[int, int]: ...

    async def retire(self, table: str, source: str, seen_before: datetime,
                     window_start: datetime | None = None) -> int: ...

    async def areas(self, kind: str) -> list[dict[str, Any]]: ...


class RunLog(Protocol):
    async def record_run(self, *, source: str, target: str, status: str, started_at: datetime, fetched: int,
                         written: int, retired: int, detail: str, rate_limited: bool) -> None: ...

    async def gate(self, source: str) -> GateState: ...


@dataclass
class SourceReport:
    source: str
    target: Target
    status: Status
    started_at: datetime
    detail: str = ""
    fetched: int = 0
    results: Counter[str] = field(default_factory=Counter)
    errors: int = 0
    retired: int = 0
    rate_limited: bool = False

    @property
    def written(self) -> int:
        return sum(n for r, n in self.results.items() if r not in ("duplicate", "unique"))

    def summary(self) -> str:
        counts = ", ".join(f"{n} {r}" for r, n in sorted(self.results.items())) or "nothing written"
        parts = [f"{self.source}: {self.status}", f"fetched {self.fetched}", counts]
        if self.errors:
            parts.append(f"{self.errors} failed")
        if self.retired:
            parts.append(f"removed {self.retired}")
        if self.detail:
            parts.append(self.detail)
        return "; ".join(parts)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class RunContext:
    """One run of the loader: its settings, where it writes, and what its
    sources share. `started` is the run's start: every row a source writes
    is seen then, and what it last saw earlier is what it retires. With
    `dry_run` nothing is written and the sinks may be None; `seen` then
    collects fingerprints across sources, to count duplicates."""

    config: LoaderConfig
    opportunities: OpportunitySink | None = None
    resources: ResourceSink | None = None
    public_data: PublicDataSink | None = None
    runs: RunLog | None = None
    dry_run: bool = False
    clock: Callable[[], datetime] = _now
    started: datetime = field(default_factory=_now)
    seen: set[str] = field(default_factory=set)
    tracts: AreaIndex | None = None


class Loader(ABC):
    name: ClassVar[str]
    target: ClassVar[Target]
    description: ClassVar[str]
    cadence: ClassVar[Cadence] = Cadence.DAILY
    # Public-data tables the source owns: after a clean run, its rows there
    # that the run didn't see are removed.
    tables: ClassVar[tuple[str, ...]] = ()
    # An empty result is real (an alert feed with no alerts), so it still
    # removes what's gone.
    empty_is_valid: ClassVar[bool] = False

    def missing(self, config: LoaderConfig) -> str | None:
        """Why the source can't run with this configuration, or None when it can."""
        return None

    def min_interval(self, config: LoaderConfig) -> timedelta:
        """The least time between two attempts, across every loader sharing
        the database (utils/rate_gate.py). None by default."""
        return timedelta(0)

    def backoff(self, config: LoaderConfig) -> timedelta:
        """How long to wait after the server raised RateLimited."""
        return DEFAULT_BACKOFF

    def fingerprint(self, item: Any) -> str:
        """What makes two rows the same, for --dry-run's duplicate count."""
        return f"{type(item).__name__}|{item.external_id}"

    @abstractmethod
    async def fetch(self, config: LoaderConfig) -> Fetched: ...

    @abstractmethod
    async def write(self, items: Fetched, report: SourceReport, context: RunContext) -> None: ...

    async def run(self, context: RunContext) -> SourceReport:
        report = SourceReport(self.name, self.target, Status.OK, started_at=context.clock())
        if reason := self.missing(context.config):
            report.status, report.detail = Status.SKIPPED, reason
            logger.info(report.summary())
            await self._record(report, context)
            return report
        if not await self._gate_allows(report, context):
            return report
        try:
            items = await self.fetch(context.config)
        except RateLimited as exc:
            report.status, report.detail, report.rate_limited = Status.FAILED, f"rate limited: {exc}", True
            logger.error(report.summary())
            await self._record(report, context)
            return report
        except Exception as exc:  # one broken source mustn't stop the rest
            report.status, report.detail = Status.FAILED, f"fetch failed: {exc}"
            logger.error(report.summary())
            await self._record(report, context)
            return report
        report.fetched = len(items)
        if context.dry_run:
            report.status = Status.DRY_RUN
            for item in items:
                key = self.fingerprint(item)
                report.results["duplicate" if key in context.seen else "unique"] += 1
                context.seen.add(key)
            logger.info(report.summary())
            return report
        try:
            await self.write(items, report, context)
        except Exception as exc:
            report.status, report.detail = Status.FAILED, f"write failed: {type(exc).__name__}"
            logger.exception("%s: writing failed", self.name)
        logger.log(logging.ERROR if report.status is Status.FAILED else logging.INFO, report.summary())
        await self._record(report, context)
        return report

    async def _gate_allows(self, report: SourceReport, context: RunContext) -> bool:
        """False, with the report filled in, when the source must not ask its
        server now. A hold isn't recorded: it isn't an attempt, and the app
        shows the last real run's status instead. A dry run has no database,
        so nothing holds it back."""
        if context.runs is None:
            return True
        try:
            state = await context.runs.gate(self.name)
        except Exception:
            report.status, report.detail = Status.FAILED, "couldn't read the run log for the rate gate"
            logger.exception(report.summary())
            return False
        reason = rate_gate.hold(state, min_interval=self.min_interval(context.config),
                                backoff=self.backoff(context.config), now=report.started_at)
        if reason is None:
            return True
        report.status, report.detail = Status.SKIPPED, reason
        logger.info(report.summary())
        return False

    @staticmethod
    async def _record(report: SourceReport, context: RunContext) -> None:
        if context.runs is None or context.dry_run:
            return
        try:
            await context.runs.record_run(
                source=report.source, target=report.target.value, status=report.status.value,
                started_at=report.started_at, fetched=report.fetched, written=report.written,
                retired=report.retired, detail=report.detail, rate_limited=report.rate_limited,
            )
        except Exception:
            logger.exception("%s: couldn't record the run", report.source)


async def run_all(loaders: Iterable[Loader], context: RunContext) -> list[SourceReport]:
    """Runs `loaders` in order, each on its own."""
    return [await loader.run(context) for loader in loaders]


def _unique(items: Iterable[Any]) -> list[Any]:
    """One row per (type, external id): a source can list a row twice."""
    return list({(type(item).__name__, item.external_id): item for item in items}.values())


# --- Opportunities and resources: row by row (0013_data_loader.sql) ---------------

# The same fingerprints as app.opportunity_fingerprint and
# app.resource_fingerprint, for --dry-run's duplicate count.
# tests/integration/test_loader_flows.py checks they agree.
_NOT_ALNUM = re.compile(r"[^a-z0-9]+")


def _normalize(value: str | None) -> str:
    return _NOT_ALNUM.sub("", (value or "").lower())


def opportunity_fingerprint(item: ImportedOpportunity) -> str:
    city = (item.location or "").split(",", 1)[0]
    return "|".join((item.kind.value, _normalize(item.title), _normalize(item.organization), _normalize(city)))


def resource_fingerprint(item: ImportedResource) -> str:
    return _normalize(item.name)


class _RowLoader(Loader):
    """Writes each row through its sync function; when every row wrote,
    closes what the source no longer lists."""

    @abstractmethod
    def _sink(self, context: RunContext) -> OpportunitySink | ResourceSink | None: ...

    async def write(self, items: Fetched, report: SourceReport, context: RunContext) -> None:
        sink = self._sink(context)
        if sink is None:
            raise RuntimeError(f"No database for {self.target}")
        for item in _unique(items):
            try:
                result = await sink.sync_upsert(item, context.started)
            except Exception:
                report.errors += 1
                logger.exception("%s: writing %s failed", self.name, item.external_id)
                continue
            report.results[result.value] += 1
        if report.errors:
            report.status, report.detail = Status.FAILED, "rows failed to write; nothing closed"
        elif not items:
            report.detail = "the source listed nothing; nothing closed"
        else:
            report.retired = await sink.sync_retire(self.name, context.started)


class OpportunityLoader(_RowLoader):
    """A source of opportunities. When two sources list the same posting, the
    earlier one in the run order keeps it (the database skips the later one
    as a duplicate)."""

    target = Target.OPPORTUNITIES

    def _sink(self, context: RunContext) -> OpportunitySink | None:
        return context.opportunities

    def fingerprint(self, item: Any) -> str:
        return opportunity_fingerprint(item)


class ResourceLoader(_RowLoader):
    target = Target.RESOURCES

    def _sink(self, context: RunContext) -> ResourceSink | None:
        return context.resources

    def fingerprint(self, item: Any) -> str:
        return resource_fingerprint(item)


# --- Public data: in bulk (0014_public_data.sql) ----------------------------------


class PublicDataLoader(Loader):
    """Writes every row in one bulk sync per table; after a clean run,
    removes what the source no longer lists from the tables it owns
    (incidents only within the refreshed window)."""

    async def write(self, items: Fetched, report: SourceReport, context: RunContext) -> None:
        sink = context.public_data
        if sink is None:
            raise RuntimeError(f"No database for {self.target}")
        rows: list[ImportedRow] = list(_unique(items))
        if any(isinstance(r, (ImportedIncident, ImportedSignal)) for r in rows):
            rows = await _tag_tracts(rows, context, sink)
        written, inserted = await sink.sync(self.name, rows, context.started)
        report.results.update({"inserted": inserted, "updated": written - inserted})
        report.results = +report.results  # drop zero counts
        if not rows and not self.empty_is_valid:
            report.detail = "the source listed nothing; nothing removed"
            return
        window_start = context.started - timedelta(days=context.config.nibrs_window_days)
        for table in self.tables:
            report.retired += await sink.retire(table, self.name, context.started,
                                                window_start if table == "external_incidents" else None)


async def _tag_tracts(rows: list[ImportedRow], context: RunContext, sink: PublicDataSink) -> list[ImportedRow]:
    """Puts each located incident or call in its census tract (the
    boundaries source loads the tracts, and runs first; until it has, none
    are tagged)."""
    if context.tracts is None:
        context.tracts = AreaIndex.from_rows(await sink.areas("census_tract"))
    tagged: list[ImportedRow] = []
    for row in rows:
        if isinstance(row, (ImportedIncident, ImportedSignal)) and row.tract_geoid is None:
            tract = context.tracts.find(row.latitude, row.longitude)
            if tract:
                row = row.model_copy(update={"tract_geoid": tract})
        tagged.append(row)
    return tagged
