"""Tasks: the work a case needs (services/task.py)."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel
from models.case_enums import CaseCategory, CasePriority


class TaskStatus(StrEnum):
    OPEN = "open"
    DONE = "done"


class Task(ApiModel):
    """A piece of work on a case: generated when the case comes in
    (services/task.py), or added by a worker."""

    id: UUID
    case_id: UUID
    case_number: int
    case_title: str
    case_category: CaseCategory
    case_priority: CasePriority
    title: str
    detail: str
    status: TaskStatus
    # The task's own assignee, or the case's when the task has none.
    assigned_worker_id: UUID | None = None
    assigned_worker_name: str | None = None
    due_at: datetime | None = None
    created_by: UUID | None = None
    created_at: datetime
    completed_at: datetime | None = None
    completed_by: UUID | None = None


class TaskFilters(ApiModel):
    case_id: UUID | None = None
    # Only tasks the caller holds (theirs, or unassigned on a case they hold).
    mine: bool = False
    open_only: bool = True
    limit: int = Field(default=200, ge=1, le=500)


class CreateTaskRequest(ApiModel):
    """A task a worker adds to a case. Without `assigned_worker_id` it
    follows the case (whoever holds it)."""

    # Same limit as the column (models/case.py Title; that module imports
    # this one).
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    due_at: datetime | None = None
    assigned_worker_id: UUID | None = None


class UpdateTaskRequest(ApiModel):
    """Only the fields sent change. Send `assigned_worker_id: null` to hand
    the task back to whoever holds the case."""

    status: TaskStatus | None = None
    assigned_worker_id: UUID | None = None

    @property
    def unassign(self) -> bool:
        return "assigned_worker_id" in self.model_fields_set and self.assigned_worker_id is None
