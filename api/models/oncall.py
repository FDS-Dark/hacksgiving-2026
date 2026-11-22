"""On call: who is on now and next, the rota, the "On call" switch, and
urgent alerts offered to whoever is on (services/oncall.py)."""

from datetime import datetime
from enum import IntEnum, StrEnum
from uuid import UUID

from pydantic import AwareDatetime

from models.base import ApiModel
from models.case import ContactMethod
from models.case_enums import CaseCategory, CasePriority


class ShiftSource(StrEnum):
    # An admin put it on the rota.
    SCHEDULE = "schedule"
    # The holder switched themselves on.
    TOGGLE = "toggle"


class ShiftRank(IntEnum):
    PRIMARY = 1
    BACKUP = 2


class OncallShift(ApiModel):
    id: UUID
    user_id: UUID
    display_name: str | None = None
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    rank: ShiftRank
    source: ShiftSource


class OncallMe(ApiModel):
    on_call: bool
    # The caller's shift covering now, when they're on.
    shift: OncallShift | None = None


class OncallNow(ApiModel):
    # Shifts covering now, primary first.
    on_call: list[OncallShift]
    # The first shift starting within 12 hours whose holder isn't on now.
    next: OncallShift | None = None
    me: OncallMe


class ToggleOncallRequest(ApiModel):
    """Switch yourself on or off. `until` (in the future, within 24 hours)
    sets when it ends; without it a new shift ends at the next 07:00, 17:00
    or 23:00 org time, and a running one keeps its end."""

    on: bool
    until: AwareDatetime | None = None


class CreateShiftRequest(ApiModel):
    user_id: UUID
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    rank: ShiftRank = ShiftRank.PRIMARY


class UpdateShiftRequest(ApiModel):
    """Only the fields sent change."""

    user_id: UUID | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    rank: ShiftRank | None = None


# --- Urgent alerts (docs/design/on-call-and-push.md D3) ---------------------------


class AlertStatus(StrEnum):
    # Offered to the current step's people.
    OFFERING = "offering"
    # Every step ran out; admins are reminded until someone accepts.
    UNANSWERED = "unanswered"
    ACCEPTED = "accepted"
    # Someone assigned the case by hand.
    RESOLVED = "resolved"
    # The case was resolved or closed, or stopped paging.
    CANCELLED = "cancelled"


OPEN_ALERT_STATUSES = frozenset({AlertStatus.OFFERING, AlertStatus.UNANSWERED})


class OfferOutcome(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    PASSED = "passed"
    TIMED_OUT = "timed_out"
    # Someone else accepted first.
    SUPERSEDED = "superseded"


class PassReason(StrEnum):
    BUSY = "busy"
    TOO_FAR = "too_far"
    NOT_SAFE_ALONE = "not_safe_alone"


class MyOffer(ApiModel):
    """The caller's latest offer on an alert."""

    id: UUID
    step: int
    expires_at: datetime
    outcome: OfferOutcome


class OncallAlert(ApiModel):
    id: UUID
    case_id: UUID
    case_number: int
    case_title: str
    category: CaseCategory
    priority: CasePriority
    status: AlertStatus
    step: int
    step_expires_at: datetime | None = None
    created_at: datetime
    accepted_by: UUID | None = None
    accepted_by_name: str | None = None
    accepted_at: datetime | None = None
    arrived_at: datetime | None = None
    my_offer: MyOffer | None = None
    # Who it goes to if this step runs out (offering only).
    next_name: str | None = None


class OncallAlertDetail(OncallAlert):
    """The alert with what a responder needs to decide and go. Never the
    requester's contact details: those stay on the case."""

    description: str
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    contact_method: ContactMethod | None = None
    safe_to_contact: bool | None = None


class PassRequest(ApiModel):
    reason: PassReason | None = None


class OncallStats(ApiModel):
    """Alerts opened in [from, to). Times are seconds from the alert opening
    to its accept, and from the accept to "I've arrived"."""

    alerts: int
    accepted: int
    unanswered: int
    avg_seconds_to_accept: float | None = None
    avg_seconds_to_arrive: float | None = None
    # Every reason, 0 when unused; "none" counts passes without a reason.
    passes_by_reason: dict[str, int]
