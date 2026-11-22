"""The community resource directory: anyone signed in browses it, staff add
to it. Referring a case to a resource is a case rule (services/case.py)."""

from uuid import UUID

from databridge.resource import ResourceDatabridge
from errors import not_found
from models.assist import ResourceOutcomes
from models.case_enums import CaseCategory
from models.resource import CreateResourceRequest, Resource
from models.staff import StaffMember


class ResourceService:
    def __init__(self, resources: ResourceDatabridge) -> None:
        self.resources = resources

    async def search(self, query: str | None, category: CaseCategory | None) -> list[Resource]:
        return await self.resources.search(query, category)

    async def outcome_stats(self) -> dict[UUID, ResourceOutcomes]:
        return await self.resources.outcome_stats()

    async def get(self, resource_id: UUID) -> Resource:
        resource = await self.resources.get(resource_id)
        if resource is None:
            raise not_found("resource")
        return resource

    async def create(self, worker: StaffMember, body: CreateResourceRequest) -> Resource:
        return await self.resources.create(body, worker.id)
