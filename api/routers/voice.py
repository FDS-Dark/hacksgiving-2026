import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from dependencies import (
    get_case_service,
    get_current_user,
    get_current_worker,
    get_opportunity_service,
    get_routing_service,
    get_voice_service,
    require_tool_secret,
)
from models.case import AnonymousRequestReceipt
from models.opportunity import Opportunity, OpportunityKind
from models.routing import SERVICE_DESCRIPTIONS, Service
from models.staff import StaffMember
from models.user import AppUser
from models.voice import (
    ClaimHandoffRequest,
    CreateHandoffRequest,
    CreateReferralRequest,
    HandoffCode,
    ImpactSummary,
    RecordOutcomeRequest,
    ReferralOutcome,
    VoiceCallReview,
    VoiceCallReviewDetail,
    VoiceResource,
    VoiceDashboard,
    VoiceFollowUp,
    VoiceAppCapabilities,
    VoiceAppService,
    VoiceCaseReceipt,
    VoiceCaseRequest,
    VoiceRouteRequest,
    VoiceRouteResponse,
    VoiceReferral,
    VoiceReferralDetail,
    WebhookAccepted,
)
from services.case import CaseService
from services.opportunity import OpportunityService
from services.routing import RoutingService
from services.voice import VoiceService
from settings import config

router = APIRouter(prefix="/voice", tags=["voice"])
logger = logging.getLogger(__name__)

SERVICE_NAMES: dict[Service, str] = {
    Service.HOMELESSNESS: "Housing & Shelter",
    Service.MISSING_PERSONS: "Missing Persons",
    Service.MEAL_PROGRAMS: "Meals & Food",
    Service.VIOLENCE_PREVENTION: "Violence Prevention",
    Service.TRANSPORTATION: "Transportation",
    Service.INCIDENT_DEESCALATION: "De-escalation",
    Service.BURIAL_ASSISTANCE: "Burial Assistance",
    Service.BRIDGE_TO_EMPLOYMENT: "Bridge to Employment",
    Service.UNCLEAR: "General Support",
}


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
        config.voice.tool_secret,
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


@router.get(
    "/opportunities",
    response_model=list[Opportunity],
    dependencies=[Depends(require_tool_secret)],
)
async def opportunities(
    q: Annotated[str | None, Query(max_length=200)] = None,
    kind: OpportunityKind | None = None,
    service: OpportunityService = Depends(get_opportunity_service),
) -> list[Opportunity]:
    """Open jobs and volunteer postings from the same directory as the app."""
    return await service.search(q, kind, include_closed=False, limit=25)


@router.get(
    "/app-capabilities",
    response_model=VoiceAppCapabilities,
    dependencies=[Depends(require_tool_secret)],
)
async def app_capabilities() -> VoiceAppCapabilities:
    """The public app actions a phone agent may accurately describe."""
    services = [
        VoiceAppService(
            key=key,
            name=SERVICE_NAMES[key],
            description=description,
            app_destination=f"Get Help > {SERVICE_NAMES[key]}",
        )
        for key, description in SERVICE_DESCRIPTIONS.items()
        if key != Service.UNCLEAR
    ]
    return VoiceAppCapabilities(
        services=services,
        features=[
            "Get Help submits a signed-in request to the appropriate ComForce service queue.",
            "With explicit consent, the phone navigator can submit an anonymous "
            "Get Help request containing only the caller-approved summary and fields.",
            "Safety Map shows generalized public-safety information and is not monitored for emergencies.",
            "Me > Safety alerts shows private connected-call follow-ups plus public updates while the app is open.",
            "Me > Phone calls connects a call with a one-time eight-character handoff code.",
            "Me > Volunteer and jobs opens searchable jobs and volunteer postings from ComForce and partners.",
        ],
        handoff_steps=[
            "The navigator asks whether the caller is already signed in to the app.",
            "Write down the eight-character code; it expires after 15 minutes and works once.",
            "If already signed in: open Me > Phone calls, enter the code, and tap Connect call.",
            "If not signed in: open Expo Go, sign in, then open Me > Phone calls, "
            "enter the code, and tap Connect call.",
            "A successful claim shows Call connected and the follow-up under Phone calls; "
            "Me > Safety alerts also shows the ComForce notification.",
            "If a retry says invalid, expired, or already claimed after success, "
            "the one-time code was already consumed.",
        ],
        limitations=[
            "The phone navigator cannot sign in, submit an authenticated Get Help "
            "request, or read private account data; phone submissions are anonymous.",
            "Only currently open opportunities returned by the opportunities tool may be described.",
            "Call notifications are in-app follow-ups, not operating-system push notifications.",
            "Past connected-call referrals appear under Me > Phone calls > Past referrals, "
            "with reviewed details and tappable public phone numbers when available.",
            "Never invent a department, opportunity, resource, or app capability that a tool did not return.",
        ],
    )


@router.post(
    "/route",
    response_model=VoiceRouteResponse,
    dependencies=[Depends(require_tool_secret)],
)
async def route_voice_request(
    body: VoiceRouteRequest,
    routing: RoutingService = Depends(get_routing_service),
    voice: VoiceService = Depends(get_voice_service),
) -> VoiceRouteResponse:
    """Use the app's classifier and keep its structured route on the call."""
    routed = await routing.route(body.message)
    stored_category = (
        "other" if routed.service == Service.UNCLEAR else routed.service.value
    )
    await voice.record_route(body.conversation_id, stored_category, routed.urgent)
    return VoiceRouteResponse(
        service=routed.service,
        service_name=SERVICE_NAMES[routed.service],
        also_relevant=routed.also_relevant,
        also_relevant_names=[SERVICE_NAMES[item] for item in routed.also_relevant],
        urgent=routed.urgent,
        reason=routed.reason,
        follow_up_question=routed.follow_up_question,
    )


@router.post(
    "/requests",
    response_model=VoiceCaseReceipt,
    dependencies=[Depends(require_tool_secret)],
)
async def submit_voice_request(
    body: VoiceCaseRequest,
    cases: CaseService = Depends(get_case_service),
    voice: VoiceService = Depends(get_voice_service),
) -> VoiceCaseReceipt:
    """Create a consented anonymous Get Help case from approved fields only."""
    receipt: AnonymousRequestReceipt = await cases.submit_anonymous_request(
        body.as_submit_request(), None
    )
    try:
        await voice.record_case_submission(
            body.conversation_id,
            receipt.request.id,
            receipt.request.number,
            receipt.request.category,
            body.contact_method,
        )
    except Exception:
        # The ComForce case is the primary outcome. Do not make ElevenLabs retry
        # and create a duplicate merely because call analytics were unavailable.
        logger.exception(
            "Voice case metadata could not be linked for request #%s",
            receipt.request.number,
        )
    return VoiceCaseReceipt(
        request_id=receipt.request.id,
        request_number=receipt.request.number,
        category=receipt.request.category,
        access_code=receipt.access_code,
        status=receipt.request.status.value,
    )


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
    return await service.create_handoff(
        body.conversation_id, body.caller_id, config.voice.tool_secret
    )


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


@router.get("/referrals", response_model=list[VoiceReferralDetail])
async def my_referrals(
    user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> list[VoiceReferralDetail]:
    """Reviewed resources referred during calls linked to this account."""
    return await service.referrals_for_user(user.id)


@router.get("/referrals/{referral_id}", response_model=VoiceReferralDetail)
async def my_referral(
    referral_id: UUID,
    user: AppUser = Depends(get_current_user),
    service: VoiceService = Depends(get_voice_service),
) -> VoiceReferralDetail:
    return await service.referral_for_user(user.id, referral_id)


@router.get("/staff/calls", response_model=list[VoiceCallReview])
async def staff_call_reviews(
    _worker: StaffMember = Depends(get_current_worker),
    service: VoiceService = Depends(get_voice_service),
) -> list[VoiceCallReview]:
    """Structured call outcomes for ComForce review; never transcripts."""
    return await service.call_reviews()


@router.get("/staff/calls/{call_id}", response_model=VoiceCallReviewDetail)
async def staff_call_review(
    call_id: UUID,
    _worker: StaffMember = Depends(get_current_worker),
    service: VoiceService = Depends(get_voice_service),
) -> VoiceCallReviewDetail:
    return await service.call_review(call_id)


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
