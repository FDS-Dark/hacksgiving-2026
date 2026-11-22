"""The database's vocabularies the imports use. The values are the columns'
checks (and the API's own enums, api/models/case_enums.py and
api/models/opportunity.py); a new value needs a migration first."""

from enum import StrEnum


class CaseCategory(StrEnum):
    """A resource's category: ComForce MKE's services, plus other."""

    HOMELESSNESS = "homelessness"
    MISSING_PERSONS = "missing_persons"
    MEAL_PROGRAMS = "meal_programs"
    VIOLENCE_PREVENTION = "violence_prevention"
    TRANSPORTATION = "transportation"
    INCIDENT_DEESCALATION = "incident_deescalation"
    BURIAL_ASSISTANCE = "burial_assistance"
    BRIDGE_TO_EMPLOYMENT = "bridge_to_employment"
    OTHER = "other"


class OpportunityKind(StrEnum):
    VOLUNTEER = "volunteer"
    JOB = "job"
    EDUCATION = "education"


class Audience(StrEnum):
    """Who a posting is open to, beyond everyone: an import is tagged when
    its source says so."""

    SECOND_CHANCE = "second_chance"  # open to people with a conviction record
    UNHOUSED = "unhoused"  # works for someone without a fixed address
    NO_EXPERIENCE = "no_experience"
    NO_ID_REQUIRED = "no_id_required"
    YOUTH = "youth"


class Cost(StrEnum):
    FREE = "free"
    LOW_COST = "low_cost"
    PAID = "paid"
