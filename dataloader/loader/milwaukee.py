"""City of Milwaukee public data: boundaries, NIBRS incidents, and MPD and MFD
dispatched calls.

MPD's calls page allows 10 requests per 30 minutes per IP address, and
production, staging and local dev all leave from the same one. So
`mpd_calls` asks at most every APP__LOADER__MPD_MIN_INTERVAL_SECONDS,
whatever the schedule, and after the page refuses, nobody sharing the
database asks again for APP__LOADER__MPD_BACKOFF_SECONDS (utils/rate_gate.py).
"""

from datetime import UTC, datetime, timedelta

from client import milwaukee
from loader.base import Cadence, Fetched, PublicDataLoader, Target
from settings import LoaderConfig


class BoundariesLoader(PublicDataLoader):
    name = milwaukee.BOUNDARIES_SOURCE
    target = Target.AREAS
    description = "MPD districts, census tracts, neighborhoods and aldermanic districts (City of Milwaukee)"
    tables = ("geo_areas",)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with milwaukee.client(config.timeout * 4) as http:
            return await milwaukee.fetch_boundaries(http)


class NibrsLoader(PublicDataLoader):
    name = milwaukee.NIBRS_SOURCE
    target = Target.INCIDENTS
    description = "MPD-reviewed incidents, NIBRS (City of Milwaukee, CC BY)"
    tables = ("external_incidents",)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        now = datetime.now(UTC)
        async with milwaukee.client(config.timeout * 2) as http:
            return await milwaukee.fetch_incidents(http, since=now - timedelta(days=config.nibrs_window_days),
                                                   now=now, limit=50000)


class MpdCallsLoader(PublicDataLoader):
    name = milwaukee.MPD_CALLS_SOURCE
    target = Target.SIGNALS
    description = "MPD dispatched calls, delayed 30-90 minutes"
    cadence = Cadence.LIVE
    tables = ("external_signals",)
    empty_is_valid = True

    def min_interval(self, config: LoaderConfig) -> timedelta:
        return timedelta(seconds=config.mpd_min_interval_seconds)

    def backoff(self, config: LoaderConfig) -> timedelta:
        return timedelta(seconds=config.mpd_backoff_seconds)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with milwaukee.client(config.timeout) as http:
            return await milwaukee.fetch_mpd_calls(http, ttl=timedelta(hours=config.signal_ttl_hours))


class MfdCallsLoader(PublicDataLoader):
    name = milwaukee.MFD_CALLS_SOURCE
    target = Target.SIGNALS
    description = "MFD dispatched calls (fire and EMS)"
    cadence = Cadence.LIVE
    tables = ("external_signals",)
    empty_is_valid = True

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with milwaukee.client(config.timeout) as http:
            return await milwaukee.fetch_mfd_calls(http, ttl=timedelta(hours=config.signal_ttl_hours))
