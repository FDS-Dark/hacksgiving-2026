from uuid import UUID

from databridge.base import Databridge
from models.case_enums import CaseCategory
from models.resource import CreateResourceRequest, Resource


class ResourceDatabridge(Databridge):
    async def search(self, query: str | None, category: CaseCategory | None) -> list[Resource]:
        rows = await self._rows("resource_list", query=(query or "").strip() or None, category=category)
        return [Resource(**row) for row in rows]

    async def get(self, resource_id: UUID) -> Resource | None:
        row = await self._first("resource_get", resource_id=resource_id)
        return Resource(**row) if row else None

    async def create(self, body: CreateResourceRequest, created_by: UUID) -> Resource:
        return Resource(**await self._one(
            "resource_create",
            name=body.name, category=body.category, description=body.description, address=body.address or None,
            neighborhood=body.neighborhood or None, phone=body.phone or None, website=body.website or None,
            hours=body.hours or None, latitude=body.latitude, longitude=body.longitude, created_by=created_by,
        ))
