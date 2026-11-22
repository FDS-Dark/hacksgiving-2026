"""The case-management domain: requests for help and incidents, as ComForce
MKE workers handle them (Case*) and as the person who asked sees them
(PublicRequest*). The two shapes are separate on purpose: nothing internal
(notes, contact details, who the assignee is beyond a first name) is a
field of a public model."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import ConfigDict, Field, StringConstraints, model_validator

from models.base import ApiModel
from models.case_enums import CaseCategory, CasePriority
from models.task import Task


class CaseStatus(StrEnum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    AWAITING_RESOURCES = "awaiting_resources"
    RESOLVED = "resolved"
    CLOSED = "closed"


CLOSED_STATUSES = frozenset({CaseStatus.RESOLVED, CaseStatus.CLOSED})


class CaseKind(StrEnum):
    REQUEST = "request"
    INCIDENT = "incident"


class CaseSource(StrEnum):
    PUBLIC = "public"
    WORKER = "worker"


class UpdateType(StrEnum):
    CREATED = "created"
    NOTE = "note"
    MESSAGE = "message"
    STATUS_CHANGE = "status_change"
    PRIORITY_CHANGE = "priority_change"
    CATEGORY_CHANGE = "category_change"
    ASSIGNMENT = "assignment"
    REFERRAL = "referral"
    # The requester answering on their own request.
    REPLY = "reply"
    # On-call escalation (accepted, on scene); always internal.
    ALERT = "alert"


class Visibility(StrEnum):
    INTERNAL = "internal"
    PUBLIC = "public"


class ContactMethod(StrEnum):
    """How a resident wants to be reached. `none`: don't reach out at all."""

    CALL = "call"
    TEXT = "text"
    NONE = "none"


class ReferralStatus(StrEnum):
    SUGGESTED = "suggested"
    SHARED = "shared"
    ACCEPTED = "accepted"
    # The person got the help: who delivered it is recorded.
    COMPLETED = "completed"
    DECLINED = "declined"


class DeliveredBy(StrEnum):
    """Who delivered a completed referral's help: the referral's own
    resource (the provider), or ComForce MKE itself (a named worker)."""

    PROVIDER = "provider"
    COMFORCE = "comforce"


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Outcome = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Location = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
ContactField = Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]


# --- Worker view -----------------------------------------------------------------


class Case(ApiModel):
    id: UUID
    number: int
    kind: CaseKind
    title: str
    description: str
    category: CaseCategory
    priority: CasePriority
    status: CaseStatus
    source: CaseSource
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    requester_id: UUID | None = None
    assigned_worker_id: UUID | None = None
    assigned_worker_name: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    referral_count: int
    last_activity_at: datetime
    # How the requester wants to be reached; None when nobody asked (cases a
    # worker opens).
    contact_method: ContactMethod | None = None
    # "It's safe to call or leave a voicemail" (or to text). False means be
    # careful: no voicemail, and don't say why you're calling to someone else.
    safe_to_contact: bool | None = None


class CaseUpdate(ApiModel):
    """One entry in a case's history: a note, a message to the requester, or
    a change the system recorded."""

    id: UUID
    case_id: UUID
    case_number: int
    case_title: str
    author_id: UUID | None = None
    author_name: str | None = None
    update_type: UpdateType
    visibility: Visibility
    content: str
    created_at: datetime


class Referral(ApiModel):
    id: UUID
    case_id: UUID
    resource_id: UUID
    resource_name: str
    resource_category: CaseCategory
    resource_phone: str | None = None
    resource_website: str | None = None
    resource_is_sample: bool
    status: ReferralStatus
    outcome: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime
    delivered_by: DeliveredBy | None = Field(default=None, description="Set once the referral is completed.")
    delivered_by_worker_id: UUID | None = None
    delivered_by_worker_name: str | None = None
    confirmed_by: UUID | None = None
    confirmed_by_name: str | None = None
    confirmed_at: datetime | None = None


class CaseDetail(ApiModel):
    case: Case
    updates: list[CaseUpdate]
    referrals: list[Referral]
    tasks: list[Task]


class PersonMatch(StrEnum):
    ACCOUNT = "account"
    PHONE = "phone"
    EMAIL = "email"


class Person(ApiModel):
    """The resident behind a case, as staff see them: their contact details
    (from their newest case that has them) and every case that looks like
    the same person. There's no separate person record; see 0024."""

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    contact_method: ContactMethod | None = None
    safe_to_contact: bool | None = None
    has_account: bool = Field(description="They have a resident account (their own requests).")
    matched_by: list[PersonMatch] = Field(description="How the other cases were matched to this person.")
    first_contact_at: datetime
    last_activity_at: datetime
    open_cases: int
    cases: list[Case] = Field(description="Newest first; includes the case asked about.")


class CreateCaseRequest(ApiModel):
    """A case a worker opens (a phone call, a walk-in, an incident)."""

    title: Title
    description: LongText = ""
    kind: CaseKind = CaseKind.REQUEST
    category: CaseCategory = CaseCategory.OTHER
    priority: CasePriority = CasePriority.MEDIUM
    location: Location | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    contact_name: ContactField | None = None
    contact_phone: ContactField | None = None
    contact_email: ContactField | None = None
    assigned_worker_id: UUID | None = None


class UpdateCaseRequest(ApiModel):
    """Only the fields sent change. Send `assigned_worker_id: null` to
    unassign."""

    title: Title | None = None
    description: LongText | None = None
    kind: CaseKind | None = None
    category: CaseCategory | None = None
    priority: CasePriority | None = None
    status: CaseStatus | None = None
    location: Location | None = None
    assigned_worker_id: UUID | None = None
    handoff_note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)] | None = (
        Field(
            default=None,
            description="With a change of `assigned_worker_id`: what the new owner needs to know (where things "
            "stand, what's next). Saved on the case's history as an internal note and sent with the assignment "
            "notification. Ignored when the owner doesn't actually change.",
        )
    )

    @property
    def unassign(self) -> bool:
        return "assigned_worker_id" in self.model_fields_set and self.assigned_worker_id is None


class AddCaseUpdateRequest(ApiModel):
    """An internal note, or (visibility public) a message the requester will
    see on their request."""

    content: RequiredText
    visibility: Visibility = Visibility.INTERNAL


class CaseFilters(ApiModel):
    status: CaseStatus | None = None
    priority: CasePriority | None = None
    category: CaseCategory | None = None
    kind: CaseKind | None = None
    assigned_worker_id: UUID | None = None
    unassigned: bool = False
    open_only: bool = False
    q: str | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


# --- Insights --------------------------------------------------------------------


class CaseStats(ApiModel):
    total: int
    active: int
    new: int
    high_priority_active: int
    awaiting_resources: int
    unassigned_active: int
    resolved: int
    opened_last_7_days: int
    resolved_last_7_days: int
    avg_resolution_hours: float | None = None


class CategoryCount(ApiModel):
    category: CaseCategory
    total: int
    active: int


class StatusCount(ApiModel):
    status: CaseStatus
    total: int


class CaseInsights(ApiModel):
    """Everything on the dashboard, computed from the case tables."""

    stats: CaseStats
    by_category: list[CategoryCount]
    by_status: list[StatusCount]
    recent_activity: list[CaseUpdate]


# --- Referrals -------------------------------------------------------------------


class AddReferralRequest(ApiModel):
    resource_id: UUID
    status: ReferralStatus = ReferralStatus.SUGGESTED


class UpdateReferralRequest(ApiModel):
    status: ReferralStatus | None = None
    outcome: Outcome | None = None
    delivered_by: DeliveredBy | None = Field(
        default=None,
        description="With status completed (or on a completed referral): who delivered the help. "
        "Defaults to the provider. You are recorded as the one who confirmed it.",
    )
    delivered_by_worker_id: UUID | None = Field(
        default=None, description="With delivered_by comforce: which worker (default: you)."
    )

    @model_validator(mode="after")
    def _something(self) -> "UpdateReferralRequest":
        if self.status is None and self.outcome is None and self.delivered_by is None:
            raise ValueError("Send a status, an outcome, who delivered the help, or several")
        if self.delivered_by_worker_id is not None and self.delivered_by != DeliveredBy.COMFORCE:
            raise ValueError("delivered_by_worker_id goes with delivered_by comforce")
        if self.delivered_by is not None and self.status not in (None, ReferralStatus.COMPLETED):
            raise ValueError("Who delivered the help is recorded only on a completed referral")
        return self


# --- Public view (the person who asked for help) ---------------------------------


class SubmitRequest(ApiModel):
    """A community member asking for help. Who they are comes from their
    sign-in. Priority, status and assignee are for workers to set: a body
    that sends them (or any unknown field) is rejected with 422."""

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    description: RequiredText
    title: Title | None = None
    category: CaseCategory | None = Field(
        default=None, description="Leave out to let ComForce sort it (the AI router, when it's configured)."
    )
    location: Location | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    contact_name: ContactField | None = None
    contact_phone: ContactField | None = None
    contact_email: ContactField | None = None
    contact_method: ContactMethod | None = Field(
        default=None, description="Call or text needs `contact_phone`. Leave out when the form didn't ask."
    )
    safe_to_contact: bool | None = Field(
        default=None, description="It's safe to call or leave a voicemail (or to text)."
    )

    @model_validator(mode="after")
    def _reachable(self) -> "SubmitRequest":
        if self.contact_method in (ContactMethod.CALL, ContactMethod.TEXT) and not (self.contact_phone or "").strip():
            raise ValueError("A phone number is needed to call or text")
        return self


class PublicRequest(ApiModel):
    id: UUID
    number: int
    title: str
    description: str
    category: CaseCategory
    status: CaseStatus
    location: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    contact_method: ContactMethod | None = Field(
        default=None, description="How the requester asked to be reached; null when the form didn't ask."
    )
    worker_first_name: str | None = Field(
        default=None,
        description="First name of the ComForce worker the request is assigned to; null until someone is. "
        "Nothing else about staff reaches the requester.",
    )


class PublicRequestUpdate(ApiModel):
    id: UUID
    update_type: UpdateType
    content: str
    created_at: datetime


class PublicRequestDetail(ApiModel):
    request: PublicRequest
    updates: list[PublicRequestUpdate]


class AnonymousRequestReceipt(ApiModel):
    """A request sent without an account. The access code is shown once:
    with the request's number it is the only way back to the request."""

    request: PublicRequest
    access_code: str


Reply = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ReplyRequest(ApiModel):
    """The requester's answer on their own request. Staff see it in the case
    history."""

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    content: Reply
