"""Whether a source may ask its server now, from what app.loader_runs says
about its earlier attempts (loader_run_gate, databridge/loader_run.py).

Every process that shares the database agrees, because the answer comes
from the database: two loaders on one laptop, a CronJob and a catch-up run,
an old loader still running next to a new one. Two rules:

* Minimum interval. A source asks at most once per interval, counted from
  the start of its last attempt, successful or failed. Skipped runs aren't
  attempts (counting them would push the next run back forever). A little
  grace keeps a schedule that equals the interval (every 5 minutes against
  300 s) from skipping a tick whenever a pod starts a moment early.
* Backoff. After the server refused for asking too often
  (client.errors.RateLimited), nobody asks again until the backoff has
  passed since that attempt. Retrying sooner never recovers, because each
  refused request counts against the limit too.

Checking and attempting aren't atomic: two processes that check within the
same few seconds can both go ahead. That costs one extra request, which the
intervals leave room for.
"""

from datetime import datetime, timedelta

from model.loader_run import GateState

GRACE = timedelta(seconds=30)


def _minutes(delta: timedelta) -> str:
    minutes = max(1, round(delta.total_seconds() / 60))
    return f"{minutes} minute{'' if minutes == 1 else 's'}"


def hold(state: GateState, *, min_interval: timedelta, backoff: timedelta, now: datetime) -> str | None:
    """Why the source must wait, or None when it may ask now."""
    if state.last_rate_limited_at is not None:
        waited = now - state.last_rate_limited_at
        if waited < backoff:
            return f"rate limited {_minutes(waited)} ago; backing off {_minutes(backoff - waited)} more"
    if min_interval > timedelta(0) and state.last_attempt_at is not None:
        waited = now - state.last_attempt_at
        if waited < min_interval - GRACE:
            return f"asked {_minutes(waited)} ago; asks at most every {_minutes(min_interval)}"
    return None
