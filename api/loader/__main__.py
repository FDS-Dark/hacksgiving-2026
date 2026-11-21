"""python -m loader: run the data loader (docs/data-loader.md).

    python -m loader                  every source, once
    python -m loader --cadence live   the live sources (calls, alerts), once
    python -m loader --watch          keep running: live sources every few
                                      minutes, daily ones at start and daily
    python -m loader --dry-run        fetch and report; write nothing
    python -m loader --list           the sources and whether each can run

Exits 1 when a source failed, so the Kubernetes CronJob records the run as
failed; a source skipped for missing credentials is not a failure."""

import argparse
import asyncio
import logging
import sys
import time
from collections.abc import Sequence

from databridge.executor import PostgresExecutor
from databridge.opportunity import OpportunityDatabridge
from databridge.public_data import PublicDataDatabridge
from databridge.resource import ResourceDatabridge
from engine.postgres_engine import PostgresDBEngine
from loader.runner import SourceReport, Status, run
from loader.sources import BY_NAME, SOURCES, Cadence, Source
from logging_setup import configure_logging
from settings import config

logger = logging.getLogger("loader")
DAY_SECONDS = 24 * 3600


def _parse(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m loader", description=__doc__,
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


def _chosen(args: argparse.Namespace, cadence: Cadence | None = None) -> list[Source]:
    chosen = [BY_NAME[name] for name in args.source] if args.source else list(SOURCES)
    wanted = cadence or (Cadence(args.cadence) if args.cadence else None)
    # Keep the run order whatever order --source named them in.
    return sorted((s for s in chosen if wanted is None or s.cadence is wanted), key=SOURCES.index)


async def _once(sources: list[Source], dry_run: bool) -> list[SourceReport]:
    if dry_run:
        return await run(sources, config.loader, opportunities=None, resources=None, dry_run=True)
    executor = PostgresExecutor(PostgresDBEngine())
    public = PublicDataDatabridge(executor)
    try:
        return await run(sources, config.loader, opportunities=OpportunityDatabridge(executor),
                         resources=ResourceDatabridge(executor), public_data=public, runs=public)
    finally:
        await executor.dispose()


async def _watch(args: argparse.Namespace) -> int:
    """Live sources every few minutes; daily ones now and then every 24
    hours. A failed run is logged and the loop goes on."""
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


async def _main(args: argparse.Namespace) -> int:
    if args.list:
        for source in SOURCES:
            reason = source.missing(config.loader)
            print(f"{source.name:24} {source.target:13} {source.cadence:6} {'ready' if not reason else reason}\n"
                  f"{'':24} {source.description}")
        return 0
    if args.watch:
        return await _watch(args)
    reports = await _once(_chosen(args), args.dry_run)
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
