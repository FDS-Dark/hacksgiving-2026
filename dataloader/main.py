"""The data loader (docs/data-loader.md): keeps imported opportunities,
resources and public data current.

    python main.py                   every source, once
    python main.py --cadence live    the live sources (calls, alerts), once,
                                     plus any daily source that hasn't
                                     succeeded in a day (loader/schedule.py)
    python main.py --source NAME     just this source (repeatable)
    python main.py --watch           keep running: live sources every few
                                     minutes, daily ones at start and daily
    python main.py --dry-run         fetch and report; write nothing
    python main.py --list            the sources and whether each can run

Exits 1 when a source failed, so the Kubernetes CronJob records the run as
failed. A source skipped for missing credentials, or held back by the rate
gate (utils/rate_gate.py), is not a failure."""

import argparse
import asyncio
import logging
import sys
import time
from collections.abc import Sequence
from datetime import UTC, datetime

import dependencies
from loader.base import Cadence, Loader, RunContext, SourceReport, Status, run_all
from loader.schedule import stale_daily
from loader.sources import BY_NAME, SOURCES
from settings import config
from utils.logging_config import configure_logging

logger = logging.getLogger("loader")
DAY_SECONDS = 24 * 3600


def _parse(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python main.py", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", action="append", choices=list(BY_NAME), metavar="NAME",
                        help="Run only this source (repeatable). Default: all of them.")
    parser.add_argument("--cadence", choices=[c.value for c in Cadence],
                        help="Run only the sources with this cadence.")
    parser.add_argument("--watch", action="store_true",
                        help="Keep running: live sources every APP__LOADER__LIVE_EVERY_SECONDS, daily ones daily.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report; write nothing.")
    parser.add_argument("--list", action="store_true", help="List the sources and whether each can run.")
    return parser.parse_args(argv)


def _chosen(args: argparse.Namespace, cadence: Cadence | None = None) -> list[Loader]:
    chosen = [BY_NAME[name] for name in args.source] if args.source else list(SOURCES)
    wanted = cadence or (Cadence(args.cadence) if args.cadence else None)
    # Keep the run order whatever order --source named them in.
    return sorted((s for s in chosen if wanted is None or s.cadence is wanted), key=SOURCES.index)


async def _once(sources: list[Loader], dry_run: bool, catch_up: bool = False) -> list[SourceReport]:
    if dry_run:
        return await run_all(sources, RunContext(config.loader, dry_run=True))
    runs = dependencies.get_loader_run_databridge()
    if catch_up:
        stale = stale_daily(SOURCES, await runs.source_health(), config.loader, datetime.now(UTC))
        if stale:
            logger.info("Catching up daily sources: %s", ", ".join(s.name for s in stale))
            sources = sorted({*sources, *stale}, key=SOURCES.index)
    context = RunContext(
        config.loader,
        opportunities=dependencies.get_opportunity_databridge(),
        resources=dependencies.get_resource_databridge(),
        public_data=dependencies.get_public_data_databridge(),
        runs=runs,
    )
    return await run_all(sources, context)


async def _watch(args: argparse.Namespace) -> int:
    """Live sources every few minutes (the rate gate holds MPD to its own
    interval); daily ones now and then every 24 hours. A failed run is
    logged and the loop goes on."""
    next_daily = 0.0
    while True:
        started = time.monotonic()
        sources = _chosen(args, Cadence.LIVE)
        if started >= next_daily:
            sources = _chosen(args)
            next_daily = started + DAY_SECONDS
        try:
            await _once(sources, args.dry_run)
        except Exception:
            logger.exception("Loader run failed")
        await asyncio.sleep(max(5.0, config.loader.live_every_seconds - (time.monotonic() - started)))


def _list() -> None:
    for source in SOURCES:
        reason = source.missing(config.loader)
        interval = source.min_interval(config.loader).total_seconds()
        limit = f", at most every {interval:.0f}s" if interval else ""
        print(f"{source.name:24} {source.target:13} {source.cadence:6} {reason or 'ready'}{limit}\n"
              f"{'':24} {source.description}")


async def _main(args: argparse.Namespace) -> int:
    if args.list:
        _list()
        return 0
    try:
        if args.watch:
            return await _watch(args)
        # A live run without --source also catches up stale daily sources.
        catch_up = args.cadence == Cadence.LIVE.value and not args.source
        reports = await _once(_chosen(args), args.dry_run, catch_up)
    finally:
        await dependencies.dispose()
    # Each source logged its summary as it finished.
    return 1 if any(r.status is Status.FAILED for r in reports) else 0


def main(argv: Sequence[str] | None = None) -> int:
    configure_logging(config.logging)
    try:
        return asyncio.run(_main(_parse(argv)))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
