from uuid import UUID

from databridge.base import Databridge
from models.case import CaseCategory, CreateResourceRequest, Referral, ReferralStatus, Resource


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
            hours=body.hours or None, created_by=created_by,
        ))

    async def list_referrals(self, case_id: UUID) -> list[Referral]:
        return [Referral(**row) for row in await self._rows("referral_list", case_id=case_id)]

    async def add_referral(
        self, case_id: UUID, resource_id: UUID, status: ReferralStatus, actor_id: UUID
    ) -> Referral | None:
        row = await self._first("referral_add", case_id=case_id, resource_id=resource_id, status=status,
                                actor_id=actor_id)
        return Referral(**row) if row else None

    async def update_referral(
        self, case_id: UUID, referral_id: UUID, status: ReferralStatus | None, outcome: str | None, actor_id: UUID
    ) -> Referral | None:
        row = await self._first("referral_update", case_id=case_id, referral_id=referral_id, status=status,
                                outcome=outcome, actor_id=actor_id)
        return Referral(**row) if row else None
