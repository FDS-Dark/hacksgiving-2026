"""The community resource directory: services people can be referred to
(services/resource.py). A referral of a case to a resource is part of the
case domain (models/case.py Referral)."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from models.base import ApiModel
from models.case import ContactField, Latitude, Location, LongText, Longitude, Title
from models.case_enums import CaseCategory


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
    latitude: float | None = None
    longitude: float | None = None
    source: str = Field(default="manual", description="'manual' for staff-entered, else the import's source.")
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
    latitude: Latitude | None = None
    longitude: Longitude | None = None
