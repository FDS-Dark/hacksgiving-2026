"""Asking for help without an account: an emergency shouldn't wait on a
sign-in. The request's number and the access code it came back with are
the only way back to it. Nothing here needs a token, so every route is
rate limited per client address (services/rate_limit.py)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, status

from dependencies import get_case_service, get_request_push_service, get_triager
from models.case import (
    AnonymousRequestReceipt,
    PublicRequestDetail,
    PublicRequestUpdate,
    ReplyRequest,
    SubmitRequest,
)
from models.push import SubscribeRequestPush
from services.case import CaseService, Triager
from services.request_push import RequestPushService
from services.rate_limit import anonymous_submissions, code_lookups

router = APIRouter(prefix="/public/requests", tags=["requests"])

AccessCode = Annotated[str, Header(alias="X-Access-Code", max_length=32, description="The code from the receipt.")]
Number = Annotated[int, Path(ge=1, description="The request's reference number, like 1042.")]


@router.post(
    "",
    response_model=AnonymousRequestReceipt,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(anonymous_submissions)],
)
async def submit_anonymous_request(
    body: SubmitRequest,
    service: CaseService = Depends(get_case_service),
    triage: Triager | None = Depends(get_triager),
) -> AnonymousRequestReceipt:
    """Ask ComForce MKE for help without signing in. Same body as
    `POST /v1/requests`. Keep the access code: it's shown only this once.
    429 after a few requests from one address in an hour."""
    return await service.submit_anonymous_request(body, triage)


@router.get("/{number}", response_model=PublicRequestDetail, dependencies=[Depends(code_lookups)])
async def get_anonymous_request(
    number: Number,
    code: AccessCode,
    service: CaseService = Depends(get_case_service),
) -> PublicRequestDetail:
    """A request sent without an account, with its public updates. 404 for
    a wrong number or code alike."""
    return await service.request_by_code(number, code)


@router.post(
    "/{number}/replies",
    response_model=PublicRequestUpdate,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(code_lookups)],
)
async def reply_to_anonymous_request(
    number: Number,
    body: ReplyRequest,
    code: AccessCode,
    service: CaseService = Depends(get_case_service),
) -> PublicRequestUpdate:
    """Answer on a request sent without an account."""
    return await service.reply_by_code(number, code, body)


@router.post(
    "/{number}/devices",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(code_lookups)],
)
async def subscribe_to_anonymous_request(
    number: Number,
    body: SubscribeRequestPush,
    code: AccessCode,
    service: RequestPushService = Depends(get_request_push_service),
) -> None:
    """This phone gets a push ("You have a new update", no sound) when
    ComForce replies or the status changes. At most 3 phones per request.
    404 for a wrong number or code alike."""
    await service.subscribe(number, code, body)


@router.delete(
    "/{number}/devices/{token}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(code_lookups)],
)
async def unsubscribe_from_anonymous_request(
    number: Number,
    token: Annotated[str, Path(max_length=200)],
    code: AccessCode,
    service: RequestPushService = Depends(get_request_push_service),
) -> None:
    """Stop this phone's pushes for the request (forgetting it on the phone)."""
    await service.unsubscribe(number, code, token)
