"""Imported resources (0013_data_loader.sql): upsert by the source's id,
skipping duplicates of open rows, and close what a source stopped listing."""

from datetime import datetime

from databridge.base import Databridge
from model.imported import ImportedResource, SyncResult


class ResourceDatabridge(Databridge):
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
