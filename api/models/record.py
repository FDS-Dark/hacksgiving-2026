"""Phantom records: what a worker captured after a call or a visit, and
what the pipeline made of it (services/record.py, worker/stages.py)."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from models.base import ApiModel
from models.case import Case, CaseKind, ContactField, Location, Title
from models.case_enums import CaseCategory, CasePriority


class RecordSource(StrEnum):
    TEXT = "text"
    AUDIO = "audio"


class RecordStatus(StrEnum):
    PROCESSING = "processing"
    READY = "ready"
    CONFIRMING = "confirming"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    DISCARDED = "discarded"


class RecordStage(StrEnum):
    """Where a record is in the pipeline. Each stage is one job kind."""

    UPLOAD = "upload"
    TRANSCRIBE = "transcribe"
    REDACT = "redact"
    EXTRACT = "extract"
    DONE = "done"


# --- What the AI extracts (an OpenAI structured-output schema, so plain BaseModel) ---


class ExtractedTask(BaseModel):
    title: str = Field(description="A short, concrete next step for ComForce staff, as an imperative.")
    due_in_hours: int | None = Field(
        description="How soon it should be done, in hours from now, if the record makes that clear; else null."
    )


class Extraction(BaseModel):
    """The AI's reading of a record. Suggestions only: the author reviews and
    edits all of it before a case is created."""

    title: str = Field(description="A short title for the case, under 80 characters, with no names.")
    summary: str = Field(
        description="Two to four plain sentences: what happened and what the person needs. No names."
    )
    kind: CaseKind = Field(
        description="request: someone needs help. incident: something happened that staff responded to."
    )
    category: CaseCategory = Field(description="The ComForce service that should own this.")
    priority: CasePriority = Field(
        description="critical or high only if someone may be in danger or the need is tonight."
    )
    location: str | None = Field(description="A street, intersection or neighborhood named in the record; else null.")
    risk_flags: list[str] = Field(
        description="Short safety concerns staff should see ('weapon mentioned', 'children present'). Empty if none."
    )
    tasks: list[ExtractedTask] = Field(description="Up to five follow-ups the record clearly calls for. Empty if none.")


# --- The HTTP contract ---

RecordText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


class CreateRecordRequest(ApiModel):
    """A typed debrief. (Voice records upload audio first; see the pipeline.)"""

    text: RecordText


class Record(ApiModel):
    id: UUID
    author_id: UUID
    source: RecordSource
    status: RecordStatus
    stage: RecordStage
    # What the author typed or said (the transcript). Staff only.
    raw_text: str | None
    extraction: Extraction | None
    case_id: UUID | None
    error: str | None
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None


class VoiceUpload(ApiModel):
    """Where the app uploads a voice debrief: PUT the audio to `upload_url`
    with this Content-Type, then call `POST /records/{id}/uploaded`."""

    record: Record
    upload_url: str
    content_type: str
    max_bytes: int
    expires_in_seconds: int


class StoredRecord(Record):
    """A record as the pipeline sees it: also the redacted text the AI reads.
    Never returned over HTTP."""

    redacted_text: str | None


class ConfirmTask(ApiModel):
    title: Title
    due_in_hours: int | None = Field(default=None, ge=1, le=24 * 14)


class ConfirmRecordRequest(ApiModel):
    """The author's reviewed version of the extraction: this becomes the case."""

    title: Title
    summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)] = ""
    kind: CaseKind = CaseKind.REQUEST
    category: CaseCategory = CaseCategory.OTHER
    priority: CasePriority = CasePriority.MEDIUM
    location: Location | None = None
    contact_name: ContactField | None = None
    contact_phone: ContactField | None = None
    tasks: list[ConfirmTask] = Field(default=[], max_length=10)


class ConfirmedRecord(ApiModel):
    record: Record
    case: Case
