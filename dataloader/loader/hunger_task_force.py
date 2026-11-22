from client import hunger_task_force
from loader.base import Fetched, ResourceLoader
from settings import LoaderConfig


class HungerTaskForceLoader(ResourceLoader):
    name = hunger_task_force.SOURCE
    description = "Food pantries, meal sites and WIC sites (Hunger Task Force map)"

    async def fetch(self, config: LoaderConfig) -> Fetched:
        async with hunger_task_force.client(config.timeout) as http:
            return (await hunger_task_force.fetch_sites(http))[: config.max_per_source]
