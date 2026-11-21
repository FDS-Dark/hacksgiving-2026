"""Volunteer and job opportunities: staff post and close them, residents
search the open ones."""

from uuid import UUID

from databridge.opportunity import OpportunityDatabridge
from errors import not_found
from models.opportunity import CreateOpportunityRequest, Opportunity, OpportunityKind
from models.staff import StaffMember


class OpportunityService:
    def __init__(self, opportunities: OpportunityDatabridge) -> None:
        self.opportunities = opportunities

    async def search(self, query: str | None, kind: OpportunityKind | None, include_closed: bool) -> list[Opportunity]:
        return await self.opportunities.search(query, kind, include_closed)

    async def get(self, opportunity_id: UUID, include_closed: bool) -> Opportunity:
        found = await self.opportunities.get(opportunity_id)
        # A closed posting is staff-only; to anyone else it doesn't exist.
        if found is None or (not found.active and not include_closed):
            raise not_found("opportunity")
        return found

    async def create(self, worker: StaffMember, body: CreateOpportunityRequest) -> Opportunity:
        return await self.opportunities.create(body, worker.id)

    async def set_active(self, opportunity_id: UUID, active: bool) -> Opportunity:
        updated = await self.opportunities.set_active(opportunity_id, active)
        if updated is None:
            raise not_found("opportunity")
        return updated
