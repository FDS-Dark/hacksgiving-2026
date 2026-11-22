"""Partner organizations (`/v1/partners`, Figma P1) and sharing a case with
one, with the resident's consent (`/v1/cases/{id}/shares`, Figma P2).
Also asking a partner for help with a case (`/v1/cases/{id}/partner-requests`).
Staff only: partners' notes, the shares and the requests are internal."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from dependencies import get_case_text_service, get_current_worker, get_partner_service
from models.case_enums import CaseCategory
from models.partner import (
    CaseShare,
    CreatePartnerRequest,
    CreateShareRequest,
    Partner,
    PartnerBody,
    PartnerRequest,
    SentPartnerRequest,
    SharedCase,
)
from models.staff import StaffMember
from models.text import CaseText
from services.partner import PartnerService
from services.text import CaseTextService

router = APIRouter(tags=["partners"])

Worker = Annotated[StaffMember, Depends(get_current_worker)]
Service = Annotated[PartnerService, Depends(get_partner_service)]


@router.get("/partners", response_model=list[Partner])
async def list_partners(
    _worker: Worker,
    service: Service,
    q: Annotated[str | None, Query(max_length=200)] = None,
    category: CaseCategory | None = None,
    include_inactive: bool = False,
) -> list[Partner]:
    """Partners by name. `category`: those taking cases of that service."""
    return await service.search(q, category, include_inactive)


@router.get("/partners/{partner_id}", response_model=Partner)
async def get_partner(partner_id: UUID, _worker: Worker, service: Service) -> Partner:
    return await service.get(partner_id)


@router.post("/partners", response_model=Partner, status_code=status.HTTP_201_CREATED)
async def create_partner(body: PartnerBody, worker: Worker, service: Service) -> Partner:
    return await service.create(worker, body)


@router.put("/partners/{partner_id}", response_model=Partner)
async def update_partner(partner_id: UUID, body: PartnerBody, _worker: Worker, service: Service) -> Partner:
    """Replaces every field. Set `active: false` to retire a partner; its
    past shares stay on record."""
    return await service.update(partner_id, body)


@router.get("/cases/{case_id}/shares", response_model=list[CaseShare])
async def list_shares(case_id: UUID, _worker: Worker, service: Service) -> list[CaseShare]:
    """Every share of the case, live and revoked, newest first."""
    return await service.shares(case_id)


@router.post("/cases/{case_id}/shares", response_model=SharedCase, status_code=status.HTTP_201_CREATED)
async def share_case(case_id: UUID, body: CreateShareRequest, worker: Worker, service: Service) -> SharedCase:
    """Share the case with a partner that accepts shares, once the person
    agreed (`consent: true` and how). Returns the message to send them:
    the summary, plus name, phone and location only when included.
    409 `partner_not_accepting` or `already_shared`."""
    return await service.share(worker, case_id, body)


@router.post("/cases/{case_id}/shares/{share_id}/revoke", response_model=CaseShare)
async def revoke_share(case_id: UUID, share_id: UUID, worker: Worker, service: Service) -> CaseShare:
    """Stop sharing (the person changed their mind, or it's no longer
    needed). The record stays, marked revoked."""
    return await service.revoke(worker, case_id, share_id)


@router.get("/cases/{case_id}/partner-requests", response_model=list[PartnerRequest])
async def list_partner_requests(case_id: UUID, _worker: Worker, service: Service) -> list[PartnerRequest]:
    """Who on staff asked which partner for what on this case, newest first."""
    return await service.requests(case_id)


@router.post(
    "/cases/{case_id}/partner-requests", response_model=SentPartnerRequest, status_code=status.HTTP_201_CREATED
)
async def request_partner_help(
    case_id: UUID, body: CreatePartnerRequest, worker: Worker, service: Service
) -> SentPartnerRequest:
    """Ask a partner for help with the case. Sends the need, your note, the
    case number and your name; the person's name and phone or location only
    when the case has a live consented share with that partner that included
    them. `delivery: sms` is texted by the worker; `compose` returns the
    message for you to send from your own email or phone. Logged on the
    case's history. 409 `partner_inactive`."""
    return await service.request_help(worker, case_id, body)


@router.get("/cases/{case_id}/texts", response_model=list[CaseText])
async def list_texts(
    case_id: UUID, _worker: Worker, service: Annotated[CaseTextService, Depends(get_case_text_service)]
) -> list[CaseText]:
    """What the requester was texted about this case (sent, skipped and
    why, failed), newest first. Never the text itself: it's generic."""
    return await service.for_case(case_id)
