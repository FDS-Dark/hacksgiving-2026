"""The case enums other domains also use (tasks, resources, referrals). They
live here, not in models/case.py, so models/task.py can use them while
models/case.py uses Task."""

from enum import StrEnum


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
