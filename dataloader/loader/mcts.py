from client import mcts
from loader.base import Cadence, Fetched, PublicDataLoader, Target
from settings import LoaderConfig


class TransitStaticLoader(PublicDataLoader):
    name = mcts.SOURCE
    target = Target.TRANSIT
    description = "MCTS routes and stops (GTFS)"
    tables = ("transit_routes", "transit_stops")

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with mcts.client(config.timeout * 4) as http:
            return await mcts.fetch_static(http)


class TransitAlertsLoader(PublicDataLoader):
    name = mcts.ALERTS_SOURCE
    target = Target.TRANSIT
    description = "MCTS service alerts (GTFS-Realtime)"
    cadence = Cadence.LIVE
    tables = ("transit_alerts",)
    empty_is_valid = True

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with mcts.client(config.timeout) as http:
            return await mcts.fetch_alerts(http)
