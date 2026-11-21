"""Volunteer and job opportunities. Anyone signed in can search the open
ones; ComForce staff post them, close them, and also see closed ones."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from dependencies import get_current_user, get_current_worker, get_opportunity_service, get_staff_service
from models.opportunity import CreateOpportunityRequest, Opportunity, OpportunityKind, UpdateOpportunityRequest
from models.staff import StaffMember
from models.user import AppUser
from services.opportunity import OpportunityService
from services.staff import StaffService

router = APIRouter(prefix="/opportunities", tags=["opportunities"])


async def _is_staff(user: AppUser, staff: StaffService) -> bool:
    return (await staff.status(user)).is_worker


@router.get("", response_model=list[Opportunity])
async def list_opportunities(
    q: Annotated[str | None, Query(max_length=200)] = None,
    kind: OpportunityKind | None = None,
    include_closed: Annotated[bool, Query(description="Staff only; ignored for everyone else.")] = False,
    user: AppUser = Depends(get_current_user),
    staff: StaffService = Depends(get_staff_service),
    service: OpportunityService = Depends(get_opportunity_service),
) -> list[Opportunity]:
    """Open opportunities, newest first. `q` matches the title,
    organization, description or location."""
    closed = include_closed and await _is_staff(user, staff)
    return await service.search(q, kind, closed)


@router.get("/{opportunity_id}", response_model=Opportunity)
async def get_opportunity(
    opportunity_id: UUID,
    user: AppUser = Depends(get_current_user),
    staff: StaffService = Depends(get_staff_service),
    service: OpportunityService = Depends(get_opportunity_service),
) -> Opportunity:
    """One opportunity. A closed one is 404 except to staff."""
    return await service.get(opportunity_id, include_closed=await _is_staff(user, staff))


@router.post("", response_model=Opportunity, status_code=status.HTTP_201_CREATED)
async def create_opportunity(
    body: CreateOpportunityRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: OpportunityService = Depends(get_opportunity_service),
) -> Opportunity:
    """Post a volunteer or job opportunity. Staff only."""
    return await service.create(worker, body)


@router.patch("/{opportunity_id}", response_model=Opportunity)
async def update_opportunity(
    opportunity_id: UUID,
    body: UpdateOpportunityRequest,
    _: StaffMember = Depends(get_current_worker),
    service: OpportunityService = Depends(get_opportunity_service),
) -> Opportunity:
    """Close (`active: false`) or reopen a posting. Staff only."""
    return await service.set_active(opportunity_id, body.active)
