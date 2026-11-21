"""The case-management domain: requests for help and incidents, as ComForce
MKE workers handle them (Case*) and as the person who asked sees them
(PublicRequest*). The two shapes are separate on purpose: nothing internal
(notes, contact details, assignee) is a field of a public model."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import ConfigDict, Field, StringConstraints, model_validator

from models.base import ApiModel


class CaseCategory(StrEnum):
    """ComForce MKE's services (models/routing.py Service), plus other."""

    HOMELESSNESS = "homelessness"
    MISSING_PERSONS = "missing_persons"
    MEAL_PROGRAMS = "meal_programs"
    VIOLENCE_PREVENTION = "violence_prevention"
    TRANSPORTATION = "transportation"
    INCIDENT_DEESCALATION = "incident_deescalation"
    BURIAL_ASSISTANCE = "burial_assistance"
    BRIDGE_TO_EMPLOYMENT = "bridge_to_employment"
    OTHER = "other"


class CasePriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


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


class Visibility(StrEnum):
    INTERNAL = "internal"
    PUBLIC = "public"


class ContactMethod(StrEnum):
    """How a resident wants to be reached. `none`: don't reach out at all."""

    CALL = "call"
    TEXT = "text"
    NONE = "none"


class TaskStatus(StrEnum):
    OPEN = "open"
    DONE = "done"


class ReferralStatus(StrEnum):
    SUGGESTED = "suggested"
    SHARED = "shared"
    ACCEPTED = "accepted"
    COMPLETED = "completed"
    DECLINED = "declined"


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


class Task(ApiModel):
    """A piece of work on a case: generated when the case comes in
    (services/tasks.py), or added by a worker."""

    id: UUID
    case_id: UUID
    case_number: int
    case_title: str
    case_category: CaseCategory
    case_priority: CasePriority
    title: str
    detail: str
    status: TaskStatus
    # The task's own assignee, or the case's when the task has none.
    assigned_worker_id: UUID | None = None
    assigned_worker_name: str | None = None
    due_at: datetime | None = None
    created_by: UUID | None = None
    created_at: datetime
    completed_at: datetime | None = None
    completed_by: UUID | None = None


class CaseDetail(ApiModel):
    case: Case
    updates: list[CaseUpdate]
    referrals: list[Referral]
    tasks: list[Task]


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

    @property
    def unassign(self) -> bool:
        return "assigned_worker_id" in self.model_fields_set and self.assigned_worker_id is None


class AddCaseUpdateRequest(ApiModel):
    """An internal note, or (visibility public) a message the requester will
    see on their request."""

    content: RequiredText
    visibility: Visibility = Visibility.INTERNAL


class TaskFilters(ApiModel):
    case_id: UUID | None = None
    # Only tasks the caller holds (theirs, or unassigned on a case they hold).
    mine: bool = False
    open_only: bool = True
    limit: int = Field(default=200, ge=1, le=500)


class UpdateTaskRequest(ApiModel):
    """Only the fields sent change. Send `assigned_worker_id: null` to hand
    the task back to whoever holds the case."""

    status: TaskStatus | None = None
    assigned_worker_id: UUID | None = None

    @property
    def unassign(self) -> bool:
        return "assigned_worker_id" in self.model_fields_set and self.assigned_worker_id is None


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


# --- Referrals and resources -----------------------------------------------------


class Resource(ApiModel):
    id: UUID
    name: str
    category: CaseCategory
    description: str
    address: str | None = None
    neighborhood: str | None = None
    phone: str | None = None
    website: str | None = None
    hours: str | None = None
    is_sample: bool
    active: bool
    created_at: datetime


class CreateResourceRequest(ApiModel):
    name: Title
    category: CaseCategory
    description: LongText = ""
    address: Location | None = None
    neighborhood: ContactField | None = None
    phone: ContactField | None = None
    website: ContactField | None = None
    hours: ContactField | None = None


class AddReferralRequest(ApiModel):
    resource_id: UUID
    status: ReferralStatus = ReferralStatus.SUGGESTED


class UpdateReferralRequest(ApiModel):
    status: ReferralStatus | None = None
    outcome: Outcome | None = None

    @model_validator(mode="after")
    def _something(self) -> "UpdateReferralRequest":
        if self.status is None and self.outcome is None:
            raise ValueError("Send a status, an outcome, or both")
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
