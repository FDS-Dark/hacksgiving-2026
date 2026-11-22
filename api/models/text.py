"""Texts to requesters (app.case_texts): outcomes only, never a body."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from models.base import ApiModel


class TextStatus(StrEnum):
    SENT = "sent"
    SKIPPED = "skipped"
    FAILED = "failed"


class PendingText(ApiModel):
    case_update_id: UUID
    case_id: UUID
    case_number: int
    update_type: str
    case_status: str
    contact_phone: str
    last_sent_at: datetime | None = None


class CaseText(ApiModel):
    id: UUID
    case_id: UUID
    case_update_id: UUID
    status: TextStatus
    reason: str | None = None
    provider_id: str | None = None
    created_at: datetime
