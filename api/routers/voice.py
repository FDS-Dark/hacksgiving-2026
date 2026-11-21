import hmac
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request

from dependencies import get_current_user, get_voice_service
from errors import ApiError
from models.user import AppUser
from models.voice import (
    ClaimHandoffRequest,
    CreateHandoffRequest,
    CreateReferralRequest,
    HandoffCode,
    ImpactSummary,
    RecordOutcomeRequest,
    VoiceReferral,
    ReferralOutcome,
    VoiceResource,
    VoiceDashboard,
    VoiceFollowUp,
    WebhookAccepted,
)
from services.voice import VoiceService
from settings import config

router = APIRouter(prefix="/voice", tags=["voice"])


def require_tool_secret(
    supplied: Annotated[str | None, Header(alias="X-Voice-Tool-Secret")] = None,
) -> None:
    expected = config.voice.tool_secret
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise ApiError(401, "invalid_tool_secret", "Invalid voice tool credentials")


@router.post("/webhooks/elevenlabs", response_model=WebhookAccepted)
async def elevenlabs_webhook(
    request: Request,
    service: VoiceService = Depends(get_voice_service),
) -> WebhookAccepted:
    """Accept signed post-call analysis; verify bytes before parsing JSON."""
    return await service.receive_elevenlabs_webhook(
        await request.body(),
        request.headers.get("ElevenLabs-Signature"),
        config.voice.elevenlabs_webhook_secret,
    )


@router.get(
    "/resources",
    response_model=list[VoiceResource],
    dependencies=[Depends(require_tool_secret)],
)
async def resources(
    category: Annotated[str | None, Query(max_length=64)] = None,
    language: Annotated[str | None, Query(max_length=12)] = None,
    service: VoiceService = Depends(get_voice_service),
) -> list[VoiceResource]:
    """Return allowlisted routes; only approved destinations expose a number."""
    return await service.resources(category, language)


@router.post(
    "/referrals",
    response_model=VoiceReferral,
    dependencies=[Depends(require_tool_secret)],
)
async def create_referral(
    body: CreateReferralRequest,
    service: VoiceService = Depends(get_voice_service),
) -> VoiceReferral:
    return await service.create_referral(
        body.conversation_id, body.resource_slug, body.status
    )


@router.post(
    "/handoffs",
    response_model=HandoffCode,
    dependencies=[Depends(require_tool_secret)],
)
async def create_handoff(
    body: CreateHandoffRequest,
    service: VoiceService = Depends(get_voice_service),
) -> HandoffCode:
    """Create a short-lived code the agent can read aloud to the caller."""
    return await service.create_handoff(body.conversation_id, config.voice.tool_secret)


@router.post("/handoffs/claim", response_model=VoiceFollowUp)
async def claim_handoff(
    body: ClaimHandoffRequest,
    user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> VoiceFollowUp:
    """Attach one call to the signed-in account without storing a phone number."""
    return await service.claim_handoff(user.id, body.code, config.voice.tool_secret)


@router.get("/follow-ups", response_model=list[VoiceFollowUp])
async def follow_ups(
    user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> list[VoiceFollowUp]:
    return await service.follow_ups(user.id)


@router.post(
    "/referrals/{referral_id}/outcome",
    response_model=ReferralOutcome,
    dependencies=[Depends(require_tool_secret)],
)
async def record_outcome(
    referral_id: UUID,
    body: RecordOutcomeRequest,
    service: VoiceService = Depends(get_voice_service),
) -> ReferralOutcome:
    return await service.record_outcome(referral_id, body.status, body.reason_code)


@router.post(
    "/referrals/{referral_id}/responder-outcome", response_model=ReferralOutcome
)
async def record_responder_outcome(
    referral_id: UUID,
    body: RecordOutcomeRequest,
    _user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> ReferralOutcome:
    return await service.record_outcome(referral_id, body.status, body.reason_code)


@router.get("/impact", response_model=ImpactSummary)
async def impact(
    _user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> ImpactSummary:
    return await service.impact()


@router.get("/dashboard", response_model=VoiceDashboard)
async def dashboard(
    _user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> VoiceDashboard:
    return await service.dashboard()
