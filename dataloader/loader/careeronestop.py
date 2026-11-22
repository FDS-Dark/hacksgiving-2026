"""CareerOneStop: jobs and training programs (Web API, needs a key) and two
public directory downloads (American Job Centers, reentry programs)."""

from client import careeronestop
from loader.base import Fetched, OpportunityLoader, ResourceLoader
from settings import LoaderConfig


def _missing(config: LoaderConfig) -> str | None:
    if not config.careeronestop_user_id or not config.careeronestop_token:
        return "needs APP__LOADER__CAREERONESTOP_USER_ID and APP__LOADER__CAREERONESTOP_TOKEN"
    return None


class CareerOneStopJobsLoader(OpportunityLoader):
    name = careeronestop.JOBS_SOURCE
    description = "Jobs from the National Labor Exchange, with fair-chance employers tagged (CareerOneStop)"

    def missing(self, config: LoaderConfig) -> str | None:
        return _missing(config)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with careeronestop.client(config.timeout) as http:
            return await careeronestop.fetch_jobs(
                http, user_id=config.careeronestop_user_id, token=config.careeronestop_token,
                keywords=config.careeronestop_job_keywords, location=config.location,
                radius_miles=config.radius_miles, max_age_days=config.max_age_days, limit=config.max_per_source,
            )


class CareerOneStopTrainingLoader(OpportunityLoader):
    name = careeronestop.TRAINING_SOURCE
    description = "Training programs WIOA can pay for (CareerOneStop)"

    def missing(self, config: LoaderConfig) -> str | None:
        return _missing(config)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with careeronestop.client(config.timeout) as http:
            return await careeronestop.fetch_training(
                http, user_id=config.careeronestop_user_id, token=config.careeronestop_token,
                location=config.location, radius_miles=config.radius_miles, limit=config.max_per_source,
            )


class JobCentersLoader(ResourceLoader):
    name = careeronestop.JOB_CENTERS_SOURCE
    description = "American Job Centers (CareerOneStop download)"

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with careeronestop.client(config.timeout) as http:
            rows = await careeronestop.fetch_job_centers(http, state=config.state, zip_prefixes=config.zip_prefixes)
        return rows[: config.max_per_source]


class ReentryLoader(ResourceLoader):
    name = careeronestop.REENTRY_SOURCE
    description = "Youth and reentry programs (CareerOneStop download)"

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with careeronestop.client(config.timeout) as http:
            rows = await careeronestop.fetch_reentry_programs(http, state=config.state,
                                                              zip_prefixes=config.zip_prefixes)
        return rows[: config.max_per_source]
