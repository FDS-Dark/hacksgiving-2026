"""Runs sources and writes what they bring: opportunities and resources row
by row through their sync functions (0013_data_loader.sql), public data in
bulk (0014_public_data.sql).

Each source runs on its own: one that fails to fetch is reported and the
rest still run. A source only removes the rows it no longer lists after a
complete, clean run: a fetch error, a row that failed to write, or an empty
result (more likely a broken source than an empty city) removes nothing.
Alert feeds are the exception: an empty feed means there are no alerts.
Every run is logged (app.loader_runs) so the app can show each source's
freshness.
"""

import logging
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol

from loader.geo import AreaIndex
from loader.sources import Fetched, Source, Target
from models.loader import ImportedOpportunity, ImportedResource, SyncResult
from models.public_data import ImportedIncident, ImportedRow, ImportedSignal
from settings import LoaderConfig

logger = logging.getLogger(__name__)


class Status(StrEnum):
    OK = "ok"
    SKIPPED = "skipped"  # missing credentials
    FAILED = "failed"
    DRY_RUN = "dry_run"


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
                         written: int, retired: int, detail: str) -> None: ...


@dataclass
class SourceReport:
    source: str
    target: Target
    status: Status
    detail: str = ""
    fetched: int = 0
    results: Counter[str] = field(default_factory=Counter)
    errors: int = 0
    retired: int = 0

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


# The same fingerprints as app.opportunity_fingerprint and
# app.resource_fingerprint, for --dry-run's duplicate count.
# test_data_loader_flows.py checks they agree.
_NOT_ALNUM = re.compile(r"[^a-z0-9]+")


def _normalize(value: str | None) -> str:
    return _NOT_ALNUM.sub("", (value or "").lower())


def opportunity_fingerprint(item: ImportedOpportunity) -> str:
    city = (item.location or "").split(",", 1)[0]
    return "|".join((item.kind.value, _normalize(item.title), _normalize(item.organization), _normalize(city)))


def resource_fingerprint(item: ImportedResource) -> str:
    return _normalize(item.name)


def _fingerprint(item: Any) -> str:
    if isinstance(item, ImportedOpportunity):
        return opportunity_fingerprint(item)
    if isinstance(item, ImportedResource):
        return resource_fingerprint(item)
    return f"{type(item).__name__}|{item.external_id}"


@dataclass
class _Context:
    config: LoaderConfig
    started: datetime
    opportunities: OpportunitySink | None
    resources: ResourceSink | None
    public_data: PublicDataSink | None
    tracts: AreaIndex | None = None


async def run(
    sources: Sequence[Source],
    config: LoaderConfig,
    *,
    opportunities: OpportunitySink | None,
    resources: ResourceSink | None,
    public_data: PublicDataSink | None = None,
    runs: RunLog | None = None,
    dry_run: bool = False,
    now: datetime | None = None,
) -> list[SourceReport]:
    """Runs `sources` in order. With `dry_run` nothing is written (the sinks
    may be None); each report then counts its unique rows and the ones that
    duplicate an earlier source in this run (the database isn't read, so it
    can't say what is already there)."""
    context = _Context(config, now or datetime.now(UTC), opportunities, resources, public_data)
    seen: set[str] = set()
    reports = []
    for source in sources:
        report = SourceReport(source.name, source.target, Status.OK)
        reports.append(report)
        if reason := source.missing(config):
            report.status, report.detail = Status.SKIPPED, reason
            logger.info(report.summary())
            await _log(runs, report, context.started, dry_run)
            continue
        try:
            items = await source.fetch(config)
        except Exception as exc:  # one broken source mustn't stop the rest
            report.status, report.detail = Status.FAILED, f"fetch failed: {exc}"
            logger.error(report.summary())
            await _log(runs, report, context.started, dry_run)
            continue
        report.fetched = len(items)
        if dry_run:
            report.status = Status.DRY_RUN
            for item in items:
                key = _fingerprint(item)
                report.results["duplicate" if key in seen else "unique"] += 1
                seen.add(key)
            logger.info(report.summary())
            continue
        try:
            if source.target in (Target.OPPORTUNITIES, Target.RESOURCES):
                await _write_rows(source, items, report, context)
            else:
                await _write_bulk(source, items, report, context)
        except Exception as exc:
            report.status, report.detail = Status.FAILED, f"write failed: {type(exc).__name__}"
            logger.exception("%s: writing failed", source.name)
        logger.log(logging.ERROR if report.status is Status.FAILED else logging.INFO, report.summary())
        await _log(runs, report, context.started, dry_run)
    return reports


async def _log(runs: RunLog | None, report: SourceReport, started: datetime, dry_run: bool) -> None:
    if runs is None or dry_run:
        return
    try:
        await runs.record_run(source=report.source, target=report.target.value, status=report.status.value,
                              started_at=started, fetched=report.fetched, written=report.written,
                              retired=report.retired, detail=report.detail)
    except Exception:
        logger.exception("%s: couldn't record the run", report.source)


async def _write_rows(source: Source, items: Fetched, report: SourceReport, context: _Context) -> None:
    sink: OpportunitySink | ResourceSink | None = (
        context.opportunities if source.target is Target.OPPORTUNITIES else context.resources
    )
    if sink is None:
        raise RuntimeError(f"No database for {source.target}")
    for item in _unique(items):
        try:
            result = await sink.sync_upsert(item, context.started)
        except Exception:
            report.errors += 1
            logger.exception("%s: writing %s failed", source.name, item.external_id)
            continue
        report.results[result.value] += 1
    if report.errors:
        report.status, report.detail = Status.FAILED, "rows failed to write; nothing closed"
    elif not items:
        report.detail = "the source listed nothing; nothing closed"
    else:
        report.retired = await sink.sync_retire(source.name, context.started)


async def _write_bulk(source: Source, items: Fetched, report: SourceReport, context: _Context) -> None:
    sink = context.public_data
    if sink is None:
        raise RuntimeError(f"No database for {source.target}")
    rows: list[ImportedRow] = list(_unique(items))
    if any(isinstance(r, (ImportedIncident, ImportedSignal)) for r in rows):
        rows = await _tag_tracts(rows, context, sink)
    written, inserted = await sink.sync(source.name, rows, context.started)
    report.results.update({"inserted": inserted, "updated": written - inserted})
    report.results = +report.results  # drop zero counts
    if not rows and not source.empty_is_valid:
        report.detail = "the source listed nothing; nothing removed"
        return
    window_start = context.started - timedelta(days=context.config.nibrs_window_days)
    for table in source.tables:
        report.retired += await sink.retire(table, source.name, context.started,
                                            window_start if table == "external_incidents" else None)


async def _tag_tracts(rows: list[ImportedRow], context: _Context, sink: PublicDataSink) -> list[ImportedRow]:
    """Puts each located incident or call in its census tract (the
    boundaries source loads the tracts; until it has, none are tagged)."""
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


def _unique(items: Iterable[Any]) -> list[Any]:
    """One row per (type, external id): a source can list a row twice."""
    return list({(type(item).__name__, item.external_id): item for item in items}.values())
