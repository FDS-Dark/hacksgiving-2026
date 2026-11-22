"""A worker's export of their own records ("Export my records", staff Me):
0032_team_chat_and_delivery.sql's export_* functions. Never contact
details, never raw text or audio."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from models.base import ApiModel


class ExportDebrief(ApiModel):
    id: UUID
    created_at: datetime
    confirmed_at: datetime | None = None
    status: str
    source: str
    title: str | None = None
    summary: str | None = None
    kind: str | None = None
    category: str | None = None
    priority: str | None = None
    location: str | None = None
    risk_flags: str | None = None
    case_number: int | None = None


class ExportCase(ApiModel):
    id: UUID
    number: int
    title: str
    kind: str
    category: str
    priority: str
    status: str
    source: str
    assigned: bool
    created: bool
    created_at: datetime
    resolved_at: datetime | None = None
    referrals: int
    helped: int


class ExportTask(ApiModel):
    id: UUID
    title: str
    case_number: int
    created_at: datetime
    due_at: datetime | None = None
    completed_at: datetime | None = None


class ExportOutcome(ApiModel):
    id: UUID
    case_id: UUID
    case_number: int
    resource_name: str
    status: str
    delivered_by: str | None = None
    delivered_by_worker_name: str | None = None
    outcome: str | None = None
    confirmed_at: datetime | None = None


class ExportSummary(ApiModel):
    debriefs: int
    cases: int
    cases_resolved: int
    people_helped: int = Field(description="Your cases that were resolved or had a referral that helped.")
    tasks_completed: int
    outcomes_confirmed: int
    referrals_helped: int = Field(description="Your cases' referrals marked completed.")


class RecordsExport(ApiModel):
    """One CSV file: a summary at the top, then a section per kind of record
    (debriefs, cases, tasks, referral outcomes)."""

    filename: str
    generated_at: datetime
    summary: ExportSummary
    csv: str
