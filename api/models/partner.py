"""Partner organizations (Figma P1) and sharing a case with one, with the
resident's consent (Figma P2). 0021_partners_and_outreach.sql."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel
from models.case import ContactField, LongText, Title
from models.case_enums import CaseCategory

Language = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=12)]
Purpose = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
ShortNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Address = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class Partner(ApiModel):
    id: UUID
    name: str
    description: str
    categories: list[CaseCategory]
    contact_name: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = None
    languages: list[str]
    accepts_shares: bool = Field(description="Has agreed to receive shared cases; only these can be shared with.")
    notes: str = Field(description="Staff only: who to ask for, intake hours, what they need.")
    active: bool
    created_at: datetime
    updated_at: datetime


class PartnerBody(ApiModel):
    """A new partner, or every field of an existing one (PUT)."""

    name: Title
    description: LongText = ""
    categories: list[CaseCategory] = Field(default_factory=list, max_length=9)
    contact_name: ContactField | None = None
    phone: ContactField | None = None
    email: ContactField | None = None
    website: ContactField | None = None
    address: Address | None = None
    languages: list[Language] = Field(default_factory=list, max_length=12)
    accepts_shares: bool = False
    notes: LongText = ""
    active: bool = True


class ConsentMethod(StrEnum):
    VERBAL = "verbal"
    WRITTEN = "written"
    IN_APP = "in_app"


class CaseShare(ApiModel):
    id: UUID
    case_id: UUID
    partner_id: UUID
    partner_name: str
    partner_email: str | None = None
    partner_phone: str | None = None
    shared_by: UUID | None = None
    shared_by_name: str | None = None
    purpose: str
    include_contact: bool
    include_location: bool
    consent_method: ConsentMethod
    consent_note: str | None = None
    created_at: datetime
    revoked_at: datetime | None = None
    revoked_by: UUID | None = None
    revoked_by_name: str | None = None


class CreateShareRequest(ApiModel):
    partner_id: UUID
    purpose: Purpose
    consent: bool = Field(description="The resident agreed to this share. Must be true.")
    consent_method: ConsentMethod
    consent_note: ShortNote | None = None
    include_contact: bool = Field(default=False, description="Also share the person's name and phone number.")
    include_location: bool = Field(default=False, description="Also share where they are.")


class SharedCase(ApiModel):
    """A new share, and the message to send the partner: the case's
    summary plus only what the resident agreed to."""

    share: CaseShare
    subject: str
    message: str


# --- Asking a partner for help with a case ------------------------------------------

RequestNote = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class PartnerRequestDelivery(StrEnum):
    """sms: texted to the partner's phone by the worker's upkeep. compose:
    the app opens the worker's own email or phone with the message."""

    SMS = "sms"
    COMPOSE = "compose"


class PartnerRequestStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    COMPOSED = "composed"


class CreatePartnerRequest(ApiModel):
    partner_id: UUID
    need: CaseCategory = Field(description="The service the help is for.")
    note: RequestNote = Field(description="What you're asking for, in your words. Leave out names and numbers.")


class PartnerRequest(ApiModel):
    id: UUID
    case_id: UUID
    partner_id: UUID
    partner_name: str
    partner_email: str | None = None
    partner_phone: str | None = None
    requested_by: UUID | None = None
    requested_by_name: str | None = None
    need: CaseCategory
    note: str
    message: str = Field(description="Everything the partner was sent.")
    delivery: PartnerRequestDelivery
    status: PartnerRequestStatus
    reason: str | None = None
    included_contact: bool = Field(description="The person's name and phone went too (a live consented share).")
    included_location: bool
    created_at: datetime
    sent_at: datetime | None = None


class SentPartnerRequest(ApiModel):
    """A new request, and (for `compose`) the message to send from the
    worker's own email or phone."""

    request: PartnerRequest
    subject: str
    message: str


class PendingPartnerText(ApiModel):
    id: UUID
    case_id: UUID
    partner_phone: str | None = None
    message: str
