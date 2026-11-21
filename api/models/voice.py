"""Privacy-minimized voice coordination models.

These contracts intentionally have no audio, transcript, caller phone number,
exact address, or free-form case narrative fields.
"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel

ShortText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
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
