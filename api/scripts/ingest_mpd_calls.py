"""Scrapes the Milwaukee Police Department calls-for-service page into the
database (services/mpd_calls.py).

    uv run python scripts/ingest_mpd_calls.py              # once (the CronJob)
    uv run python scripts/ingest_mpd_calls.py --every 120  # loop, for local dev

In production a Kubernetes CronJob (terraform/main.tf) runs it once every
two minutes with the API's own database credentials. Exit code 1 when the
run failed; the failure is also recorded in app.mpd_ingest_runs."""

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from adapters.mpd import MpdClient  # noqa: E402
from dependencies import get_executor, get_mpd_call_service  # noqa: E402
from logging_setup import configure_logging  # noqa: E402
from settings import config  # noqa: E402

logger = logging.getLogger("ingest_mpd_calls")


async def run_once(client: MpdClient) -> bool:
    started = time.monotonic()
    try:
        result = await get_mpd_call_service().ingest(client, client)
    except Exception:
        logger.exception("MPD ingest failed")
        return False
    logger.info(
        "MPD ingest ok: %d rows, %d new, %d mapped, %d geocoded, %d pruned in %.1fs",
        result.rows_seen, result.new_calls, result.mapped, result.geocoded, result.pruned,
        time.monotonic() - started,
    )
    return True


async def main(every: float | None) -> int:
    client = MpdClient()
    try:
        while True:
            ok = await run_once(client)
            if every is None:
                return 0 if ok else 1
            await asyncio.sleep(every)
    finally:
        await client.aclose()
        await get_executor().dispose()


if __name__ == "__main__":
    configure_logging(config.logging)
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--every", type=float, default=None, help="Seconds between runs; omit to run once.")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.every)))
