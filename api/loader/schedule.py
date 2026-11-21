"""Which daily sources a live run should catch up.

A daily source runs nightly. When it hasn't succeeded in the last day (a
fresh deploy, a new database, a night the source was down), the next live
run (every 5 minutes) runs it too, so nobody has to start a job by hand. A
source that keeps failing is retried at most once an hour.
"""

from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta

from loader.sources import Cadence, Source
from models.public_data import SourceHealth
from settings import LoaderConfig

FRESH_FOR = timedelta(hours=24)
RETRY_AFTER = timedelta(hours=1)


def stale_daily(
    sources: Sequence[Source], health: Iterable[SourceHealth], config: LoaderConfig, now: datetime
) -> list[Source]:
    latest = {h.source: h for h in health}
    stale = []
    for source in sources:
        if source.cadence is not Cadence.DAILY or source.missing(config):
            continue
        h = latest.get(source.name)
        succeeded_recently = h is not None and h.last_success_at is not None and now - h.last_success_at < FRESH_FOR
        tried_recently = h is not None and now - h.finished_at < RETRY_AFTER
        if not succeeded_recently and not tried_recently:
            stale.append(source)
    return stale
