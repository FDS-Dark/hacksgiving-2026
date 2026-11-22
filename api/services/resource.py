"""The community resource directory: anyone signed in browses it, staff add
to it. Referring a case to a resource is a case rule (services/case.py).

Bed counts are entered by staff (no public Milwaukee feed exists,
docs/real-data-sources.md) and shown only while fresh: a count older than
`BEDS_FRESH` reads as unknown, so nobody walks to a shelter on yesterday's
number."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from databridge.resource import ResourceDatabridge
from errors import not_found
from models.case_enums import CaseCategory
from models.resource import CreateResourceRequest, Resource
from models.staff import StaffMember

BEDS_FRESH = timedelta(hours=24)


def fresh_beds(resource: Resource, now: datetime | None = None) -> Resource:
    """`resource` with its bed count cleared when it is too old to trust."""
    at = resource.beds_updated_at
    if at is None or (now or datetime.now(UTC)) - at <= BEDS_FRESH:
        return resource
    return resource.model_copy(update={"beds_available": None, "beds_updated_at": None})


class ResourceService:
    def __init__(self, resources: ResourceDatabridge) -> None:
        self.resources = resources

    async def search(self, query: str | None, category: CaseCategory | None) -> list[Resource]:
        return [fresh_beds(r) for r in await self.resources.search(query, category)]

    async def get(self, resource_id: UUID) -> Resource:
        resource = await self.resources.get(resource_id)
        if resource is None:
            raise not_found("resource")
        return fresh_beds(resource)

    async def create(self, worker: StaffMember, body: CreateResourceRequest) -> Resource:
        return await self.resources.create(body, worker.id)

    async def set_beds(self, worker: StaffMember, resource_id: UUID, beds: int | None) -> Resource:
        resource = await self.resources.set_beds(resource_id, beds, worker.id)
        if resource is None:
            raise not_found("resource")
        return resource
