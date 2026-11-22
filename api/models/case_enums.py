"""The case enums other domains also use (tasks, resources, referrals). They
live here, not in models/case.py, so models/task.py can use them while
models/case.py uses Task."""

from enum import StrEnum
from typing import Protocol
from uuid import UUID


class CaseCategory(StrEnum):
    """ComForce MKE's services (models/routing.py Service), plus other."""

    HOMELESSNESS = "homelessness"
    MISSING_PERSONS = "missing_persons"
    MEAL_PROGRAMS = "meal_programs"
    VIOLENCE_PREVENTION = "violence_prevention"
    TRANSPORTATION = "transportation"
    INCIDENT_DEESCALATION = "incident_deescalation"
    BURIAL_ASSISTANCE = "burial_assistance"
    BRIDGE_TO_EMPLOYMENT = "bridge_to_employment"
    OTHER = "other"


class CasePriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# Priorities that page whoever is on call (docs/design/on-call-and-push.md D3).
PAGING_PRIORITIES = frozenset({CasePriority.HIGH, CasePriority.CRITICAL})
# Case statuses (models/case.py CaseStatus) that still need someone.
OPEN_STATUS_VALUES = frozenset({"new", "in_progress", "awaiting_resources"})


class Pageable(Protocol):
    """What `pages_on_call` reads from a case (models/case.py Case)."""

    @property
    def status(self) -> str: ...

    @property
    def priority(self) -> str: ...

    @property
    def assigned_worker_id(self) -> UUID | None: ...


def pages_on_call(case: Pageable) -> bool:
    """An open, unassigned case of priority high or critical pages on call.
    app.oncall_alert_open and app.oncall_alert_sweep (0018) apply the same
    rule in SQL."""
    return (
        case.status in OPEN_STATUS_VALUES
        and case.assigned_worker_id is None
        and case.priority in PAGING_PRIORITIES
    )
