from client import comforce
from loader.base import Fetched, ResourceLoader
from settings import LoaderConfig


class ComForceReviewedLoader(ResourceLoader):
    name = comforce.SOURCE
    description = "ComForce-reviewed Milwaukee phone and city services"

    async def fetch(self, config: LoaderConfig) -> Fetched:
        return comforce.resources()
