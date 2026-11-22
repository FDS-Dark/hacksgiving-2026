from uuid import UUID

from databridge.base import Databridge
from models.opportunity import Audience, CreateOpportunityRequest, Opportunity, OpportunityKind, OpportunityOrigin


class OpportunityDatabridge(Databridge):
    async def search(
        self,
        query: str | None,
        kind: OpportunityKind | None,
        include_closed: bool,
        audience: Audience | None = None,
        origin: OpportunityOrigin | None = None,
        limit: int | None = None,
    ) -> list[Opportunity]:
        rows = await self._rows(
            "opportunity_list", query=(query or "").strip() or None, kind=kind, include_closed=include_closed,
            audience=audience, origin=origin, limit=limit,
        )
        return [Opportunity(**row) for row in rows]

    async def get(self, opportunity_id: UUID) -> Opportunity | None:
        row = await self._first("opportunity_get", opportunity_id=opportunity_id)
        return Opportunity(**row) if row else None

    async def create(self, body: CreateOpportunityRequest, created_by: UUID) -> Opportunity:
        return Opportunity(**await self._one(
            "opportunity_create",
            kind=body.kind, title=body.title, organization=body.organization, description=body.description,
            location=body.location or None, schedule=body.schedule or None, pay=body.pay or None,
            contact_phone=body.contact_phone or None, contact_email=body.contact_email or None,
            apply_url=body.apply_url or None, created_by=created_by,
            audiences=[a.value for a in dict.fromkeys(body.audiences)], cost=body.cost,
        ))

    async def set_active(self, opportunity_id: UUID, active: bool) -> Opportunity | None:
        row = await self._first("opportunity_set_active", opportunity_id=opportunity_id, active=active)
        return Opportunity(**row) if row else None
