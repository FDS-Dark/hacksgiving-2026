"""Volunteer and job opportunities ComForce staff post for residents."""

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


class UpdateOpportunityRequest(ApiModel):
    active: bool = Field(description="false closes the posting (hidden from residents); true reopens it.")
