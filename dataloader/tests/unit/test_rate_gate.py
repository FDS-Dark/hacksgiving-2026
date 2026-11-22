"""The rate gate (utils/rate_gate.py): a source with a minimum interval asks
at most that often, a source its server rate limited backs off, and the
decision comes from the run log, so loaders sharing a database agree."""

from datetime import UTC, datetime, timedelta

import pytest

import main
from client.errors import RateLimited
from loader.base import RunContext, SourceReport, Status, Target, run_all
from loader.sources import BY_NAME
from model.loader_run import GateState
from settings import AppConfig, LoaderConfig
from tests.fakes import Runs, make_loader
from utils import rate_gate

NOW = datetime(2026, 11, 22, 3, tzinfo=UTC)
FIVE = timedelta(minutes=5)
FIFTEEN = timedelta(minutes=15)
HALF_HOUR = timedelta(minutes=30)


class PublicSink:
    async def sync(self, source, rows, seen_at):
        return len(rows), len(rows)

    async def retire(self, table, source, seen_before, window_start=None):
        return 0

    async def areas(self, kind):
        return []


def calls(**kwargs):
    return make_loader("mpd_calls", target=Target.SIGNALS, tables=("external_signals",), empty_is_valid=True,
                       **kwargs)


async def run_at(when, source, runs):
    (report,) = await run_all([source], RunContext(LoaderConfig(), public_data=PublicSink(), runs=runs,
                                                   started=when, clock=lambda: when))
    return report


# --- The decision -----------------------------------------------------------------------


def test_a_source_that_never_asked_may_ask():
    assert rate_gate.hold(GateState(), min_interval=FIFTEEN, backoff=HALF_HOUR, now=NOW) is None


def test_the_interval_counts_from_the_last_attempt_with_a_little_grace():
    state = GateState(last_attempt_at=NOW - timedelta(minutes=10))
    assert "at most every 15 minutes" in (rate_gate.hold(state, min_interval=FIFTEEN, backoff=HALF_HOUR, now=NOW)
                                          or "")
    # Every 5 minutes against 300 s: a pod that starts 2 s early still runs.
    early = GateState(last_attempt_at=NOW - timedelta(seconds=298))
    assert rate_gate.hold(early, min_interval=FIVE, backoff=HALF_HOUR, now=NOW) is None
    # No interval: only the backoff holds a source back.
    assert rate_gate.hold(GateState(last_attempt_at=NOW), min_interval=timedelta(0), backoff=HALF_HOUR,
                          now=NOW) is None


def test_a_rate_limit_holds_for_the_whole_backoff_whatever_the_interval():
    state = GateState(last_attempt_at=NOW - timedelta(minutes=29), last_rate_limited_at=NOW - timedelta(minutes=29))
    assert "rate limited 29 minutes ago" in (rate_gate.hold(state, min_interval=FIVE, backoff=HALF_HOUR, now=NOW)
                                             or "")
    later = GateState(last_attempt_at=NOW - timedelta(minutes=31), last_rate_limited_at=NOW - timedelta(minutes=31))
    assert rate_gate.hold(later, min_interval=FIVE, backoff=HALF_HOUR, now=NOW) is None


# --- Through a loader and the run log ------------------------------------------------------


async def test_a_source_is_skipped_within_its_minimum_interval():
    runs, source = Runs(), calls(min_interval=FIFTEEN)
    runs.attempt("mpd_calls", NOW - timedelta(minutes=5))  # another loader on this database

    report = await run_at(NOW, source, runs)

    assert report.status is Status.SKIPPED and "at most every 15 minutes" in report.detail
    assert source.fetches == 0
    # A hold isn't an attempt: it isn't recorded, so it never pushes the next run back.
    assert len(runs.recorded) == 1
    assert (await run_at(NOW + timedelta(minutes=10), source, runs)).status is Status.OK
    assert source.fetches == 1


async def test_after_rate_limited_it_backs_off_then_runs_again_after_the_window():
    runs = Runs()
    limited = calls(min_interval=FIVE, backoff=HALF_HOUR, error=RateLimited("10 requests per 30 minutes"))

    first = await run_at(NOW, limited, runs)
    assert first.status is Status.FAILED and first.rate_limited and first.detail.startswith("rate limited:")
    assert runs.recorded[-1]["rate_limited"] is True

    # Every 5 minutes, as production's CronJob would: each would count against
    # MPD's limit, so none asks until the backoff has passed.
    source = calls(min_interval=FIVE, backoff=HALF_HOUR)
    for minutes in (5, 10, 15, 20, 25):
        held = await run_at(NOW + timedelta(minutes=minutes), source, runs)
        assert held.status is Status.SKIPPED and "backing off" in held.detail
    assert source.fetches == 0

    again = await run_at(NOW + timedelta(minutes=30), source, runs)
    assert again.status is Status.OK and source.fetches == 1
    assert [r["status"] for r in runs.recorded] == ["failed", "ok"]


async def test_skips_for_missing_credentials_are_not_attempts():
    runs = Runs()
    runs.attempt("mpd_calls", NOW - timedelta(minutes=1), status="skipped")
    assert (await run_at(NOW, calls(min_interval=FIFTEEN), runs)).status is Status.OK


async def test_a_run_log_that_cant_be_read_fails_the_source_without_asking():
    class Broken(Runs):
        async def gate(self, source):
            raise ConnectionError("database down")

    source = calls(min_interval=FIFTEEN)
    report = await run_at(NOW, source, Broken())
    assert report.status is Status.FAILED and "rate gate" in report.detail
    assert source.fetches == 0


async def test_a_dry_run_has_no_run_log_and_isnt_gated():
    source = calls(min_interval=FIFTEEN)
    (report,) = await run_all([source], RunContext(LoaderConfig(), dry_run=True))
    assert report.status is Status.DRY_RUN and source.fetches == 1


# --- MPD's settings -------------------------------------------------------------------------


def test_mpd_asks_at_most_every_15_minutes_locally_and_backs_off_half_an_hour():
    mpd, config = BY_NAME["mpd_calls"], LoaderConfig()
    assert mpd.min_interval(config) == FIFTEEN and mpd.backoff(config) == HALF_HOUR
    # Every other source asks whenever its schedule says.
    assert all(s.min_interval(config) == timedelta(0) for s in BY_NAME.values() if s is not mpd)


def test_each_environment_sets_mpds_interval(monkeypatch):
    monkeypatch.setenv("APP__LOADER__MPD_MIN_INTERVAL_SECONDS", "3600")
    monkeypatch.setenv("APP__LOADER__MPD_BACKOFF_SECONDS", "2400")
    config = AppConfig().loader
    assert BY_NAME["mpd_calls"].min_interval(config) == timedelta(hours=1)
    assert BY_NAME["mpd_calls"].backoff(config) == timedelta(minutes=40)


# --- Exit codes -------------------------------------------------------------------------------


@pytest.mark.parametrize("statuses, code", [
    ([Status.OK, Status.SKIPPED], 0),  # held back or missing credentials: not a failure
    ([Status.OK, Status.FAILED], 1),
])
async def test_the_cronjob_fails_only_when_a_source_failed(monkeypatch, statuses, code):
    async def once(sources, dry_run, catch_up=False):
        return [SourceReport(f"s{i}", Target.SIGNALS, s, started_at=NOW) for i, s in enumerate(statuses)]

    monkeypatch.setattr(main, "_once", once)
    assert await main._main(main._parse(["--cadence", "live"])) == code
