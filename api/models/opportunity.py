"""Volunteer, job and education opportunities. Staff post some by hand
(source "manual"); the data loader (api/loader) imports the rest from public
sources such as USAJOBS (docs/data-loader.md)."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel
from models.case import ContactField, Location, LongText, Title


class OpportunityKind(StrEnum):
    VOLUNTEER = "volunteer"
    JOB = "job"
    EDUCATION = "education"


class Audience(StrEnum):
    """Who a posting is open to, beyond everyone: staff tag their own postings,
    and an import is tagged when its source says so."""

    SECOND_CHANCE = "second_chance"  # open to people with a conviction record
    UNHOUSED = "unhoused"  # works for someone without a fixed address
    NO_EXPERIENCE = "no_experience"
    NO_ID_REQUIRED = "no_id_required"
    YOUTH = "youth"


class Cost(StrEnum):
    FREE = "free"
    LOW_COST = "low_cost"
    PAID = "paid"


class OpportunityOrigin(StrEnum):
    """A list filter: staff postings, imported ones, or (no filter) both."""

    MANUAL = "manual"
    IMPORTED = "imported"


MANUAL_SOURCE = "manual"


Url = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500, pattern=r"^https?://\S+$")]


class Opportunity(ApiModel):
    id: UUID
    kind: OpportunityKind
    title: str
    organization: str
    description: str
    location: str | None = None
    schedule: str | None = None
    pay: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    apply_url: str | None = None
    source: str = Field(default=MANUAL_SOURCE, description="'manual' for staff postings, else the import's source.")
    audiences: list[Audience] = Field(default_factory=list)
    cost: Cost | None = None
    posted_at: datetime | None = Field(default=None, description="Imports: when the source posted it.")
    expires_at: datetime | None = Field(default=None, description="When applications close, if the source says.")
    active: bool
    created_at: datetime
    updated_at: datetime


class CreateOpportunityRequest(ApiModel):
    kind: OpportunityKind
    title: Title
    organization: Title
    description: LongText = ""
    location: Location | None = None
    schedule: ContactField | None = Field(default=None, description="When: hours, days, or the commitment.")
    pay: ContactField | None = Field(default=None, description="Jobs: the pay, e.g. '$17/hour'.")
    contact_phone: ContactField | None = None
    contact_email: ContactField | None = None
    apply_url: Url | None = Field(default=None, description="An http(s) link to apply or sign up.")
    audiences: list[Audience] = Field(default_factory=list, max_length=len(Audience))
    cost: Cost | None = Field(default=None, description="Mostly for education: free, low cost or paid.")


class UpdateOpportunityRequest(ApiModel):
    active: bool = Field(description="false closes the posting (hidden from residents); true reopens it.")
