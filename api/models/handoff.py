"""Shift handoff briefs: what a worker leaves for the next person on call
when they switch off (0020_shift_handoffs.sql)."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from models.base import ApiModel
from models.case_enums import CaseCategory, CasePriority
from models.oncall import AlertStatus


class SummarySource(StrEnum):
    RULES = "rules"
    AI = "ai"


class HandoffCase(ApiModel):
    id: UUID
    number: int
    title: str
    priority: CasePriority
    status: str
    category: CaseCategory
    last_activity_at: datetime | None = None


class HandoffTask(ApiModel):
    id: UUID
    title: str
    due_at: datetime | None = None
    overdue: bool = False
    case_id: UUID
    case_number: int
    case_title: str


class HandoffAlert(ApiModel):
    id: UUID
    case_id: UUID
    case_number: int
    case_title: str
    status: AlertStatus
    arrived_at: datetime | None = None


class HandoffBrief(ApiModel):
    """A snapshot from when the author went off call; links open the live cases."""

    cases: list[HandoffCase] = Field(default_factory=list)
    tasks: list[HandoffTask] = Field(default_factory=list)
    alerts: list[HandoffAlert] = Field(default_factory=list)


class ShiftHandoff(ApiModel):
    id: UUID
    author_id: UUID
    author_name: str | None = None
    recipient_id: UUID | None = None
    recipient_name: str | None = None
    brief: HandoffBrief
    summary: str
    summary_source: SummarySource
    created_at: datetime


class HandoffSummaryOutput(BaseModel):
    """What the AI writes (an OpenAI structured-output schema)."""

    summary: str = Field(
        description="A handoff for the next person on call, under 120 words: what needs attention first (urgent "
        "or overdue), then what's in progress. Plain sentences, no names of residents, no invented facts."
    )
