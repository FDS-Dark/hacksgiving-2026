"""Public community contracts. Never expose internal case notes or user ids."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
BodyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=800)]


class PublicResource(ApiModel):
    id: UUID
    slug: str
    name: str
    category: str
    description: str
    phone_e164: str | None = None
    website_url: str | None = None
    address_label: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    languages: list[str]
    service_area: str
    hours_label: str | None = None
    is_emergency: bool
    last_verified_at: datetime


class Opportunity(ApiModel):
    id: UUID
    title: str
    organization: str
    kind: str
    summary: str
    neighborhood: str | None = None
    schedule_label: str | None = None
    apply_url: str | None = None
    posted_at: datetime


class CreateAssistanceRequest(ApiModel):
    category: ShortText
    summary: BodyText
    neighborhood: ShortText | None = None
    contact_preference: ShortText = "in-app"


class AssistanceRequest(ApiModel):
    id: UUID
    category: str
    summary: str
    neighborhood: str | None = None
    contact_preference: str
    status: str
    created_at: datetime


class CreateCommunityPost(ApiModel):
    body: BodyText
    neighborhood: ShortText | None = None
    anonymous: bool = True


class CommunityPost(ApiModel):
    id: UUID
    body: str
    neighborhood: str | None = None
    author_label: str
    created_at: datetime


class CatalogAnswer(ApiModel):
    answer: str
    resources: list[PublicResource]
    emergency: bool = False
    disclaimer: str = Field(default="Information only. Call 911 for immediate danger.")
