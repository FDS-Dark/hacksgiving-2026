"""Case attachments and knowledge search (0025_attachments_and_knowledge.sql)."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


class AttachmentStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"


class Attachment(ApiModel):
    id: UUID
    case_id: UUID
    uploaded_by: UUID | None = None
    uploaded_by_name: str | None = None
    file_name: str
    content_type: str
    size_bytes: int
    note: str
    status: AttachmentStatus
    created_at: datetime


class StartAttachmentRequest(ApiModel):
    file_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    content_type: str = Field(description="image/jpeg, image/png, image/heic, image/heif or application/pdf.")
    size_bytes: int = Field(gt=0, le=MAX_ATTACHMENT_BYTES, description="At most 10 MB.")
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = Field(
        default="", description="What it is ('Eviction notice, dated Nov 18'): searchable by the team."
    )


class AttachmentUpload(ApiModel):
    """PUT the file to `upload_url` with this Content-Type, then call
    `POST /cases/{case_id}/attachments/{id}/uploaded`."""

    attachment: Attachment
    upload_url: str
    content_type: str
    expires_in_seconds: int


class AttachmentLink(ApiModel):
    """A short-lived link to open the file."""

    url: str
    expires_in_seconds: int


class KnowledgeKind(StrEnum):
    RESOURCE = "resource"
    CASE = "case"
    NOTE = "note"
    ATTACHMENT = "attachment"


class KnowledgeHit(ApiModel):
    kind: KnowledgeKind
    id: UUID
    case_id: UUID | None = None
    title: str
    snippet: str = Field(description="Matching words are wrapped in « ».")
    rank: float
    at: datetime | None = None
