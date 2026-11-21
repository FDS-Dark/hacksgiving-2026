"""Requests for help, as the community member who sends them sees them.
Any signed-in user may submit; each sees only their own requests, and only
the updates workers chose to share."""

from uuid import UUID

from fastapi import APIRouter, Depends, status

from dependencies import get_case_service, get_current_user, get_triager
from models.case import PublicRequest, PublicRequestDetail, SubmitRequest
from models.user import AppUser
from services.case import CaseService, Triager

router = APIRouter(prefix="/requests", tags=["requests"])


@router.post("", response_model=PublicRequest, status_code=status.HTTP_201_CREATED)
async def submit_request(
    body: SubmitRequest,
    user: AppUser = Depends(get_current_user),
    service: CaseService = Depends(get_case_service),
    triage: Triager | None = Depends(get_triager),
) -> PublicRequest:
    """Ask ComForce MKE for help. The request becomes a case in the worker
    queue with status new. Leave `category` out to have it sorted
    automatically (when AI routing is configured; otherwise it is `other`)."""
    return await service.submit_request(user, body, triage)


@router.get("", response_model=list[PublicRequest])
async def list_my_requests(
    user: AppUser = Depends(get_current_user),
    service: CaseService = Depends(get_case_service),
) -> list[PublicRequest]:
    """The caller's own requests, newest first."""
    return await service.my_requests(user)


@router.get("/{request_id}", response_model=PublicRequestDetail)
async def get_my_request(
    request_id: UUID,
    user: AppUser = Depends(get_current_user),
    service: CaseService = Depends(get_case_service),
) -> PublicRequestDetail:
    """One of the caller's requests, with its public updates (status changes
    and messages from ComForce). 404 for anyone else's."""
    return await service.my_request(user, request_id)
