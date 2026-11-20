"""The routing domain: which ComForce MKE service a request for help goes to."""

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from models.base import ApiModel


class Service(StrEnum):
    HOMELESSNESS = "homelessness"
    MISSING_PERSONS = "missing_persons"
    MEAL_PROGRAMS = "meal_programs"
    VIOLENCE_PREVENTION = "violence_prevention"
    TRANSPORTATION = "transportation"
    INCIDENT_DEESCALATION = "incident_deescalation"
    BURIAL_ASSISTANCE = "burial_assistance"
    BRIDGE_TO_EMPLOYMENT = "bridge_to_employment"
    # The request doesn't say enough to pick one; ask the person a question.
    UNCLEAR = "unclear"


# What each service covers. The classifier's prompt is built from these, so
# changing a description here changes how requests are routed.
SERVICE_DESCRIPTIONS: dict[Service, str] = {
    Service.HOMELESSNESS: "No safe place to sleep, eviction, living in a car or outside, shelter or housing help.",
    Service.MISSING_PERSONS: "Someone (a child, relative, friend) is missing, has run away or can't be reached.",
    Service.MEAL_PROGRAMS: "Hunger, no food at home, needing meals, groceries or a food pantry.",
    Service.VIOLENCE_PREVENTION: "Threats, shootings, gang or group conflict, retaliation, domestic or community "
    "violence, or wanting to stop violence before it happens.",
    Service.TRANSPORTATION: "Needing a ride to an appointment, court, work, a shelter or "
    "a service; no car or bus fare.",
    Service.INCIDENT_DEESCALATION: "A tense situation happening now or brewing: an argument, a fight about to "
    "break out, someone agitated or in crisis who needs calming down.",
    Service.BURIAL_ASSISTANCE: "Someone has died and the family needs help paying for or "
    "arranging a funeral or burial.",
    Service.BRIDGE_TO_EMPLOYMENT: "Wanting a job, job training, a resume, interview help or "
    "work after incarceration.",
    Service.UNCLEAR: "The request is too vague to choose any service above.",
}


class RouteRequest(ApiModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class Routing(BaseModel):
    """What the model must answer: the OpenAI structured-output schema."""

    service: Service = Field(description="The single best service for this request.")
    also_relevant: list[Service] = Field(
        description="Other services that would also help, best first. Empty if none. Never repeats `service`."
    )
    urgent: bool = Field(description="True if anyone may be in immediate danger to life or safety.")
    reason: str = Field(description="One short sentence on why, in plain words a staff member can read.")
    follow_up_question: str | None = Field(
        description="When service is 'unclear', one short question to ask the person; otherwise null."
    )


class RouteResponse(ApiModel):
    service: Service
    also_relevant: list[Service] = []
    urgent: bool
    reason: str
    follow_up_question: str | None = None
