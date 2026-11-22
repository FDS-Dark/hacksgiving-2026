"""When a live run catches up a daily source (loader/schedule.py)."""

from datetime import UTC, datetime, timedelta

from loader.base import Cadence
from loader.schedule import stale_daily
from model.loader_run import SourceHealth
from settings import LoaderConfig
from tests.fakes import make_loader

NOW = datetime(2026, 11, 21, 18, tzinfo=UTC)


def source(name, cadence=Cadence.DAILY, missing=None):
    return make_loader(name, cadence=cadence, missing=missing)


def health(name, *, ago, succeeded_ago=None, status="ok"):
    return SourceHealth(source=name, target="incidents", status=status, finished_at=NOW - ago, fetched=0, detail="",
                        last_success_at=NOW - succeeded_ago if succeeded_ago is not None else None)


def test_daily_sources_that_never_ran_or_went_stale_are_caught_up():
    sources = [source("never"), source("fresh"), source("stale"), source("calls", Cadence.LIVE),
               source("keyless", missing="needs a key")]
    runs = [health("fresh", ago=timedelta(hours=3), succeeded_ago=timedelta(hours=3)),
            health("stale", ago=timedelta(hours=26), succeeded_ago=timedelta(hours=26))]

    assert [s.name for s in stale_daily(sources, runs, LoaderConfig(), NOW)] == ["never", "stale"]


def test_a_failing_source_is_retried_at_most_hourly():
    sources = [source("down"), source("down_a_while")]
    runs = [health("down", ago=timedelta(minutes=10), status="failed"),
            health("down_a_while", ago=timedelta(hours=2), status="failed")]

    assert [s.name for s in stale_daily(sources, runs, LoaderConfig(), NOW)] == ["down_a_while"]
