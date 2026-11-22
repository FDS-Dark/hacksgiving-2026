from datetime import datetime
from uuid import UUID

from databridge.base import Databridge
from models.assist import ResourceOutcomes
from models.case_enums import CaseCategory
from models.loader import ImportedResource, SyncResult
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

    # --- The data loader (api/loader) ------------------------------------------

    async def sync_upsert(self, item: ImportedResource, seen_at: datetime) -> SyncResult:
        row = await self._one(
            "resource_sync_upsert",
            source=item.source, external_id=item.external_id, name=item.name, category=item.category,
            description=item.description or "", address=item.address, neighborhood=item.neighborhood,
            phone=item.phone, website=item.website, hours=item.hours, latitude=item.latitude,
            longitude=item.longitude, seen_at=seen_at,
        )
        return SyncResult(row["result"])

    async def sync_retire(self, source: str, seen_before: datetime) -> int:
        """Closes `source`'s open resources last seen before `seen_before`."""
        row = await self._one("resource_sync_retire", source=source, seen_before=seen_before)
        return int(row["retired"])

    async def outcome_stats(self) -> dict[UUID, ResourceOutcomes]:
        """Referral outcomes per resource (0023); resources never referred are absent."""
        stats: dict[UUID, ResourceOutcomes] = {}
        for row in await self._rows("resource_outcome_stats"):
            decided = row["helped"] + row["declined"]
            stats[row["resource_id"]] = ResourceOutcomes(
                referred=row["referred"], helped=row["helped"], declined=row["declined"],
                success_rate=round(row["helped"] / decided, 2) if decided else None,
            )
        return stats
