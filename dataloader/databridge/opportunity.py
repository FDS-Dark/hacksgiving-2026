"""Imported opportunities (0013_data_loader.sql): upsert by the source's id,
skipping duplicates of open rows, and close what a source stopped listing."""

from datetime import datetime

from databridge.base import Databridge
from model.imported import ImportedOpportunity, SyncResult


class OpportunityDatabridge(Databridge):
    async def sync_upsert(self, item: ImportedOpportunity, seen_at: datetime) -> SyncResult:
        row = await self._one(
            "opportunity_sync_upsert",
            source=item.source, external_id=item.external_id, kind=item.kind, title=item.title,
            organization=item.organization, description=item.description or "", location=item.location,
            schedule=item.schedule, pay=item.pay, contact_phone=item.contact_phone,
            contact_email=item.contact_email, apply_url=item.apply_url,
            audiences=[a.value for a in dict.fromkeys(item.audiences)], cost=item.cost,
            posted_at=item.posted_at, expires_at=item.expires_at, seen_at=seen_at,
        )
        return SyncResult(row["result"])

    async def sync_retire(self, source: str, seen_before: datetime) -> int:
        """Closes `source`'s open postings last seen before `seen_before`."""
        row = await self._one("opportunity_sync_retire", source=source, seen_before=seen_before)
        return int(row["retired"])
