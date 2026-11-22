from client import federal
from loader.base import Cadence, Fetched, PublicDataLoader, Target
from settings import LoaderConfig


class WeatherAlertsLoader(PublicDataLoader):
    name = federal.NWS_SOURCE
    target = Target.WEATHER
    description = "National Weather Service alerts for Milwaukee County"
    cadence = Cadence.LIVE
    tables = ("weather_alerts",)
    empty_is_valid = True

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with federal.client(config.timeout) as http:
            return await federal.fetch_weather_alerts(http, zones=config.nws_zones)


class CommunityMeasuresLoader(PublicDataLoader):
    name = federal.CDC_SOURCE
    target = Target.COMMUNITY
    description = "CDC PLACES health-related social needs by tract"
    tables = ("community_measures",)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with federal.client(config.timeout * 2) as http:
            return await federal.fetch_community_measures(http, county_fips=config.county_fips)


class CrimeTrendsLoader(PublicDataLoader):
    name = federal.FBI_SOURCE
    target = Target.CRIME
    description = "FBI Crime Data Explorer monthly totals for MPD"
    tables = ("crime_trends",)

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with federal.client(config.timeout * 2) as http:
            return await federal.fetch_crime_trends(http, api_key=config.fbi_api_key, months=config.fbi_months)
