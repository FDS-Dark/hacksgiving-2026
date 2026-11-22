"""Every source the loader imports from, in run order.

* Opportunities first, in priority order: when two sources list the same
  posting, the earlier one keeps it (the database skips the later one as a
  duplicate).
* Boundaries come before incidents and calls, which are tagged with the
  census tract they fall in.

Each source has a cadence: `daily` ones run nightly, `live` ones every few
minutes (dispatch calls and alerts). A source without its credentials is
skipped, not failed.
"""

from loader.base import Loader
from loader.careeronestop import (
    CareerOneStopJobsLoader,
    CareerOneStopTrainingLoader,
    JobCentersLoader,
    ReentryLoader,
)
from loader.comforce import ComForceReviewedLoader
from loader.federal import CommunityMeasuresLoader, CrimeTrendsLoader, WeatherAlertsLoader
from loader.hunger_task_force import HungerTaskForceLoader
from loader.mcts import TransitAlertsLoader, TransitStaticLoader
from loader.milwaukee import BoundariesLoader, MfdCallsLoader, MpdCallsLoader, NibrsLoader
from loader.usajobs import UsajobsLoader

SOURCES: tuple[Loader, ...] = (
    # Opportunities, in priority order.
    UsajobsLoader(),
    CareerOneStopJobsLoader(),
    CareerOneStopTrainingLoader(),
    # Resources.
    ComForceReviewedLoader(),
    JobCentersLoader(),
    ReentryLoader(),
    HungerTaskForceLoader(),
    # Boundaries first: incidents and calls are tagged with their tract.
    BoundariesLoader(),
    NibrsLoader(),
    MpdCallsLoader(),
    MfdCallsLoader(),
    TransitStaticLoader(),
    TransitAlertsLoader(),
    WeatherAlertsLoader(),
    CommunityMeasuresLoader(),
    CrimeTrendsLoader(),
)

BY_NAME = {source.name: source for source in SOURCES}
