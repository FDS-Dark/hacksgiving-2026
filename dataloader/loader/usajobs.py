from client import usajobs
from loader.base import Fetched, OpportunityLoader
from settings import LoaderConfig


class UsajobsLoader(OpportunityLoader):
    name = usajobs.SOURCE
    description = "Federal jobs open to the public (USAJOBS)"

    def missing(self, config: LoaderConfig) -> str | None:
        if not config.usajobs_api_key or not config.usajobs_email:
            return "needs APP__LOADER__USAJOBS_API_KEY and APP__LOADER__USAJOBS_EMAIL"
        return None

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with usajobs.client(config.usajobs_api_key, config.usajobs_email, config.timeout) as http:
            return await usajobs.fetch_jobs(
                http, location=config.location, radius_miles=config.radius_miles, max_age_days=config.max_age_days,
                limit=config.max_per_source,
            )
