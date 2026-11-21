"""The sources the loader imports from, in run order.

* Opportunities and resources: when two sources list the same posting, the
  earlier one keeps it (the database skips the later one as a duplicate).
* Boundaries come before incidents and calls, which are tagged with the
  census tract they fall in.

Each source has a cadence: `daily` ones run nightly, `live` ones every few
minutes (dispatch calls and alerts). A source without its credentials is
skipped, not failed.
"""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from adapters import careeronestop, comforce, federal, hunger_task_force, mcts, milwaukee, usajobs
from settings import LoaderConfig


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


Fetched = Sequence[Any]


@dataclass(frozen=True)
class Source:
    name: str
    target: Target
    description: str
    # Why the source can't run with this configuration, or None when it can.
    missing: Callable[[LoaderConfig], str | None]
    fetch: Callable[[LoaderConfig], Awaitable[Fetched]]
    cadence: Cadence = Cadence.DAILY
    # Public-data tables the source owns: after a clean run, its rows there
    # that the run didn't see are removed.
    tables: tuple[str, ...] = ()
    # An empty result is real (an alert feed with no alerts), so it still
    # removes what's gone.
    empty_is_valid: bool = False


def _usajobs_missing(config: LoaderConfig) -> str | None:
    if not config.usajobs_api_key or not config.usajobs_email:
        return "needs APP__LOADER__USAJOBS_API_KEY and APP__LOADER__USAJOBS_EMAIL"
    return None


def _careeronestop_missing(config: LoaderConfig) -> str | None:
    if not config.careeronestop_user_id or not config.careeronestop_token:
        return "needs APP__LOADER__CAREERONESTOP_USER_ID and APP__LOADER__CAREERONESTOP_TOKEN"
    return None


def _public(_: LoaderConfig) -> str | None:
    return None


# --- Opportunities and resources -----------------------------------------------------


async def _usajobs(config: LoaderConfig) -> Fetched:
    async with usajobs.client(config.usajobs_api_key, config.usajobs_email, config.timeout) as http:
        return await usajobs.fetch_jobs(
            http, location=config.location, radius_miles=config.radius_miles, max_age_days=config.max_age_days,
            limit=config.max_per_source,
        )


async def _careeronestop_jobs(config: LoaderConfig) -> Fetched:
    async with careeronestop.client(config.timeout) as http:
        return await careeronestop.fetch_jobs(
            http, user_id=config.careeronestop_user_id, token=config.careeronestop_token,
            keywords=config.careeronestop_job_keywords, location=config.location,
            radius_miles=config.radius_miles, max_age_days=config.max_age_days, limit=config.max_per_source,
        )


async def _careeronestop_training(config: LoaderConfig) -> Fetched:
    async with careeronestop.client(config.timeout) as http:
        return await careeronestop.fetch_training(
            http, user_id=config.careeronestop_user_id, token=config.careeronestop_token,
            location=config.location, radius_miles=config.radius_miles, limit=config.max_per_source,
        )


async def _job_centers(config: LoaderConfig) -> Fetched:
    async with careeronestop.client(config.timeout) as http:
        rows = await careeronestop.fetch_job_centers(http, state=config.state, zip_prefixes=config.zip_prefixes)
    return rows[: config.max_per_source]


async def _reentry(config: LoaderConfig) -> Fetched:
    async with careeronestop.client(config.timeout) as http:
        rows = await careeronestop.fetch_reentry_programs(http, state=config.state, zip_prefixes=config.zip_prefixes)
    return rows[: config.max_per_source]


async def _food_sites(config: LoaderConfig) -> Fetched:
    async with hunger_task_force.client(config.timeout) as http:
        return (await hunger_task_force.fetch_sites(http))[: config.max_per_source]


async def _reviewed_resources(_: LoaderConfig) -> Fetched:
    return comforce.resources()


# --- Public data --------------------------------------------------------------------------


async def _boundaries(config: LoaderConfig) -> Fetched:
    async with milwaukee.client(config.timeout * 4) as http:
        return await milwaukee.fetch_boundaries(http)


async def _nibrs(config: LoaderConfig) -> Fetched:
    now = datetime.now(UTC)
    async with milwaukee.client(config.timeout * 2) as http:
        return await milwaukee.fetch_incidents(http, since=now - timedelta(days=config.nibrs_window_days), now=now,
                                               limit=50000)


async def _mpd_calls(config: LoaderConfig) -> Fetched:
    async with milwaukee.client(config.timeout) as http:
        return await milwaukee.fetch_mpd_calls(http, ttl=timedelta(hours=config.signal_ttl_hours))


async def _mfd_calls(config: LoaderConfig) -> Fetched:
    async with milwaukee.client(config.timeout) as http:
        return await milwaukee.fetch_mfd_calls(http, ttl=timedelta(hours=config.signal_ttl_hours))


async def _transit_static(config: LoaderConfig) -> Fetched:
    async with mcts.client(config.timeout * 4) as http:
        return await mcts.fetch_static(http)


async def _transit_alerts(config: LoaderConfig) -> Fetched:
    async with mcts.client(config.timeout) as http:
        return await mcts.fetch_alerts(http)


async def _weather(config: LoaderConfig) -> Fetched:
    async with federal.client(config.timeout) as http:
        return await federal.fetch_weather_alerts(http, zones=config.nws_zones)


async def _places(config: LoaderConfig) -> Fetched:
    async with federal.client(config.timeout * 2) as http:
        return await federal.fetch_community_measures(http, county_fips=config.county_fips)


async def _fbi(config: LoaderConfig) -> Fetched:
    async with federal.client(config.timeout * 2) as http:
        return await federal.fetch_crime_trends(http, api_key=config.fbi_api_key, months=config.fbi_months)


O, R = Target.OPPORTUNITIES, Target.RESOURCES
LIVE = Cadence.LIVE

SOURCES: tuple[Source, ...] = (
    # Opportunities, in priority order.
    Source(usajobs.SOURCE, O, "Federal jobs open to the public (USAJOBS)", _usajobs_missing, _usajobs),
    Source(careeronestop.JOBS_SOURCE, O,
           "Jobs from the National Labor Exchange, with fair-chance employers tagged (CareerOneStop)",
           _careeronestop_missing, _careeronestop_jobs),
    Source(careeronestop.TRAINING_SOURCE, O, "Training programs WIOA can pay for (CareerOneStop)",
           _careeronestop_missing, _careeronestop_training),
    # Resources.
    Source(comforce.SOURCE, R, "ComForce-reviewed Milwaukee phone and city services", _public,
           _reviewed_resources),
    Source(careeronestop.JOB_CENTERS_SOURCE, R, "American Job Centers (CareerOneStop download)", _public,
           _job_centers),
    Source(careeronestop.REENTRY_SOURCE, R, "Youth and reentry programs (CareerOneStop download)", _public,
           _reentry),
    Source(hunger_task_force.SOURCE, R, "Food pantries, meal sites and WIC sites (Hunger Task Force map)",
           _public, _food_sites),
    # Boundaries first: incidents and calls are tagged with their tract.
    Source(milwaukee.BOUNDARIES_SOURCE, Target.AREAS,
           "MPD districts, census tracts, neighborhoods and aldermanic districts (City of Milwaukee)",
           _public, _boundaries, tables=("geo_areas",)),
    Source(milwaukee.NIBRS_SOURCE, Target.INCIDENTS, "MPD-reviewed incidents, NIBRS (City of Milwaukee, CC BY)",
           _public, _nibrs, tables=("external_incidents",)),
    Source(milwaukee.MPD_CALLS_SOURCE, Target.SIGNALS, "MPD dispatched calls, delayed 30-90 minutes", _public,
           _mpd_calls, LIVE, tables=("external_signals",), empty_is_valid=True),
    Source(milwaukee.MFD_CALLS_SOURCE, Target.SIGNALS, "MFD dispatched calls (fire and EMS)", _public, _mfd_calls,
           LIVE, tables=("external_signals",), empty_is_valid=True),
    Source(mcts.SOURCE, Target.TRANSIT, "MCTS routes and stops (GTFS)", _public, _transit_static,
           tables=("transit_routes", "transit_stops")),
    Source(mcts.ALERTS_SOURCE, Target.TRANSIT, "MCTS service alerts (GTFS-Realtime)", _public, _transit_alerts,
           LIVE, tables=("transit_alerts",), empty_is_valid=True),
    Source(federal.NWS_SOURCE, Target.WEATHER, "National Weather Service alerts for Milwaukee County", _public,
           _weather, LIVE, tables=("weather_alerts",), empty_is_valid=True),
    Source(federal.CDC_SOURCE, Target.COMMUNITY, "CDC PLACES health-related social needs by tract", _public,
           _places, tables=("community_measures",)),
    Source(federal.FBI_SOURCE, Target.CRIME, "FBI Crime Data Explorer monthly totals for MPD", _public, _fbi,
           tables=("crime_trends",)),
)

BY_NAME = {source.name: source for source in SOURCES}
