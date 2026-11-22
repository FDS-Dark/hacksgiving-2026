"""Privacy-minimized voice coordination models.

These contracts intentionally have no audio, transcript, exact address, or
unapproved free-form case narrative fields. A caller may explicitly approve a
short case summary for an anonymous ComForce Get Help request.
"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from models.base import ApiModel
from models.case import ContactMethod, SubmitRequest
from models.case_enums import CaseCategory
from models.routing import Service

ShortText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
VoiceMessage = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
ApprovedCaseSummary = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
]
GeneralLocation = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
HandoffCodeText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_upper=True,
        min_length=8,
        max_length=8,
        pattern=r"^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$",
    ),
]
CallerId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=8,
        max_length=16,
        pattern=r"^\+[1-9][0-9]{7,14}$",
    ),
]


class UrgencyTier(StrEnum):
    emergency = "emergency"
    urgent = "urgent"
    routine = "routine"


class VoiceReferralStatus(StrEnum):
    offered = "offered"
    accepted = "accepted"
    transfer_attempted = "transfer_attempted"
    connected = "connected"
    declined = "declined"
    unavailable = "unavailable"


class OutcomeStatus(StrEnum):
    connected = "connected"
    voicemail = "voicemail"
    no_answer = "no_answer"
    declined = "declined"
    unavailable = "unavailable"
    follow_up_needed = "follow_up_needed"
    completed = "completed"


class VoiceResource(ApiModel):
    id: UUID
    slug: str
    name: str
    category: str
    description: str
    phone_e164: str | None = None
    languages: list[str]
    service_area: str
    hours_label: str | None = None
    transfer_approved: bool
    is_emergency: bool
    last_verified_at: datetime
    verification_status: Literal["current", "review_due"] = "current"


class VoiceCall(ApiModel):
    id: UUID
    provider: str
    conversation_id: str
    language: str | None = None
    need_category: str | None = None
    urgency_tier: UrgencyTier | None = None
    neighborhood: str | None = None
    callback_consent: bool
    disposition: str | None = None
    event_timestamp: int
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime


class VoiceCallEvent(ApiModel):
    id: UUID
    call_id: UUID
    event_key: str
    event_type: str
    details: dict[str, str | bool | int | None]
    occurred_at: datetime


class CreateReferralRequest(ApiModel):
    conversation_id: ShortText
    resource_slug: ShortText
    status: VoiceReferralStatus = VoiceReferralStatus.offered


class CreateHandoffRequest(ApiModel):
    conversation_id: ShortText
    caller_id: CallerId | None = None


class VoiceRouteRequest(ApiModel):
    conversation_id: ShortText
    message: VoiceMessage


class VoiceRouteResponse(ApiModel):
    service: Service
    service_name: str
    also_relevant: list[Service]
    also_relevant_names: list[str]
    urgent: bool
    reason: str
    follow_up_question: str | None = None
    app_destination: str = "Get Help"


class VoiceCaseUrgency(StrEnum):
    """How soon a phone request needs a person. There is deliberately no
    emergency level: danger now means the caller hangs up and calls 911, and
    the request is never submitted (docs/voice/agent-prompt.md)."""

    ROUTINE = "routine"
    # Needs someone today but nobody is in danger right now: sleeping outside
    # in the cold, no food tonight, a person missing since this morning. It
    # pages whoever is on call (docs/design/on-call-and-push.md D3).
    URGENT = "urgent"


class VoiceCaseRequest(ApiModel):
    """A minimal request the caller explicitly approved for ComForce staff."""

    conversation_id: ShortText
    consent: Literal[True]
    approved_summary: ApprovedCaseSummary
    category: CaseCategory
    urgency: VoiceCaseUrgency = Field(
        description="`urgent` (needs someone today, not an emergency) pages "
        "the ComForce worker on call. Emergencies are never submitted: they "
        "go to 911.",
    )
    general_location: GeneralLocation | None = None
    contact_method: ContactMethod = ContactMethod.NONE
    caller_id: CallerId | None = None
    safe_to_contact: bool | None = None
    voicemail_allowed: bool = False
    neutral_message_only: bool = False
    safe_contact_window: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None = None

    @model_validator(mode="after")
    def _contact_consent_is_complete(self) -> "VoiceCaseRequest":
        wants_contact = self.contact_method in (
            ContactMethod.CALL,
            ContactMethod.TEXT,
        )
        if wants_contact and self.caller_id is None:
            raise ValueError("Call or text follow-up requires the system caller id")
        if wants_contact and self.safe_to_contact is None:
            raise ValueError("Call or text follow-up requires safe-to-contact consent")
        if not wants_contact and self.safe_to_contact is not None:
            raise ValueError("safe_to_contact is only valid for call or text follow-up")
        if not wants_contact and (
            self.voicemail_allowed
            or self.neutral_message_only
            or self.safe_contact_window is not None
        ):
            raise ValueError("contact safety preferences require call or text follow-up")
        if wants_contact and self.safe_to_contact is False and self.voicemail_allowed:
            raise ValueError("Voicemail cannot be allowed when contact is not marked safe")
        if self.neutral_message_only and not self.voicemail_allowed:
            raise ValueError("A neutral message requires voicemail or message permission")
        return self

    def as_submit_request(self) -> SubmitRequest:
        wants_contact = self.contact_method in (
            ContactMethod.CALL,
            ContactMethod.TEXT,
        )
        return SubmitRequest(
            description=self.approved_summary,
            category=self.category,
            location=self.general_location,
            contact_phone=self.caller_id if wants_contact else None,
            contact_method=self.contact_method,
            safe_to_contact=self.safe_to_contact if wants_contact else None,
        )


class VoiceCaseReceipt(ApiModel):
    request_id: UUID
    request_number: int
    category: CaseCategory
    access_code: str
    status: str
    urgent: bool = Field(
        default=False,
        description="The request went in as urgent and the on-call worker "
        "was alerted. It is not a dispatch: nobody is promised to arrive.",
    )


class VoiceAppService(ApiModel):
    key: Service
    name: str
    description: str
    app_destination: str


class VoiceAppCapabilities(ApiModel):
    services: list[VoiceAppService]
    features: list[str]
    handoff_steps: list[str]
    limitations: list[str]


class ClaimHandoffRequest(ApiModel):
    code: HandoffCodeText


class HandoffCode(ApiModel):
    code: str
    expires_at: datetime


class VoiceFollowUp(ApiModel):
    id: UUID
    call_id: UUID
    need_category: str | None = None
    urgency_tier: UrgencyTier | None = None
    disposition: str | None = None
    resources: list[str]
    linked_at: datetime


class VoiceReferral(ApiModel):
    id: UUID
    call_id: UUID
    resource_id: UUID
    status: VoiceReferralStatus
    created_at: datetime


class SafeContactPlan(ApiModel):
    contact_method: ContactMethod
    safe_to_contact: bool
    voicemail_allowed: bool
    neutral_message_only: bool
    safe_contact_window: str | None = None


class VoiceCheckpointRequest(ApiModel):
    conversation_id: ShortText
    caller_id: CallerId
    service: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    neighborhood: GeneralLocation | None = None
    language: Annotated[str, StringConstraints(strip_whitespace=True, max_length=12)] | None = None
    referral_slug: ShortText | None = None
    consent_pending: bool = False


class VoiceCheckpoint(ApiModel):
    service: str | None = None
    neighborhood: str | None = None
    language: str | None = None
    referral_slug: str | None = None
    consent_pending: bool
    saved_at: datetime


class VoiceResumeRequest(ApiModel):
    caller_id: CallerId


class VoiceResumeResponse(ApiModel):
    checkpoint: VoiceCheckpoint | None = None


class VoiceAwarenessCategory(ApiModel):
    category: str
    count: int = Field(ge=0)


class VoiceAwarenessSummary(ApiModel):
    district: str
    days: int
    reviewed_incidents: int = Field(ge=0)
    police_dispatch_calls: int = Field(ge=0)
    fire_ems_calls: int = Field(ge=0)
    categories: list[VoiceAwarenessCategory]
    source_note: str


class ReferralFollowUp(ApiModel):
    referral_id: UUID
    due_at: datetime | None = None
    status: Literal["not_scheduled", "pending", "completed", "needs_help"]


class ReferralFollowUpDue(ApiModel):
    referral_id: UUID
    call_id: UUID
    resource_name: str
    due_at: datetime
    need_category: str | None = None
    language: str | None = None
    neighborhood: str | None = None


class VoiceReferralDetail(ApiModel):
    id: UUID
    call_id: UUID
    need_category: str | None = None
    resource_slug: str
    resource_name: str
    resource_category: str
    resource_description: str
    phone_e164: str | None = None
    languages: list[str]
    service_area: str
    hours_label: str | None = None
    status: VoiceReferralStatus
    outcome_status: OutcomeStatus | None = None
    outcome_reason_code: str | None = None
    created_at: datetime
    follow_up_due_at: datetime | None = None
    follow_up_status: str = "not_scheduled"


class VoiceCallReview(ApiModel):
    id: UUID
    need_category: str | None = None
    urgency_tier: UrgencyTier | None = None
    callback_consent: bool
    disposition: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime
    referral_count: int = Field(ge=0)
    referral_names: list[str]
    request_id: UUID | None = None
    request_number: int | None = None


class VoiceCallReviewDetail(ApiModel):
    call: VoiceCallReview
    referrals: list[VoiceReferralDetail]
    contact_plan: SafeContactPlan | None = None


class RecordOutcomeRequest(ApiModel):
    status: OutcomeStatus
    reason_code: ShortText | None = None


class ReferralOutcome(ApiModel):
    id: UUID
    referral_id: UUID
    status: OutcomeStatus
    reason_code: str | None = None
    recorded_at: datetime


class ImpactCategory(ApiModel):
    category: str
    count: int = Field(ge=0)


class ImpactSummary(ApiModel):
    total_calls: int = Field(ge=0)
    emergency_redirects: int = Field(ge=0)
    referrals_offered: int = Field(ge=0)
    transfers_connected: int = Field(ge=0)
    follow_ups_completed: int = Field(ge=0)
    routed_calls: int = Field(default=0, ge=0)
    referrals_accepted: int = Field(default=0, ge=0)
    connection_attempts: int = Field(default=0, ge=0)
    residents_helped: int = Field(default=0, ge=0)
    follow_ups_due: int = Field(default=0, ge=0)
    incomplete_calls: int = Field(default=0, ge=0)
    tool_failures: int = Field(default=0, ge=0)
    categories: list[ImpactCategory]


class ActiveReferral(ApiModel):
    id: UUID
    category: str | None = None
    resource_name: str
    status: VoiceReferralStatus
    urgency_tier: UrgencyTier | None = None
    neighborhood: str | None = None
    created_at: datetime


class VoiceDashboard(ApiModel):
    stats: ImpactSummary
    active_referrals: list[ActiveReferral]
    routes: list[VoiceResource]


class WebhookAccepted(ApiModel):
    status: str = "received"
    duplicate: bool = False
