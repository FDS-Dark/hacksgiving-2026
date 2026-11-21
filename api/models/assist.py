"""AI help for workers: summaries, resource suggestions and draft messages.
Every result is a suggestion a worker reads first; nothing here changes a
case."""

from enum import StrEnum

from pydantic import BaseModel, Field

from models.base import ApiModel
from models.resource import Resource


class SuggestionMethod(StrEnum):
    # An OpenAI model chose from the resource list.
    AI = "ai"
    # No model available: resources in the case's category.
    RULES = "rules"


class CaseSummary(ApiModel):
    summary: str
    next_steps: list[str]


class ResourceSuggestion(ApiModel):
    resource: Resource
    reason: str


class ResourceSuggestions(ApiModel):
    method: SuggestionMethod
    suggestions: list[ResourceSuggestion]


class DraftMessage(ApiModel):
    """A message to the requester. Sent only if a worker posts it as a
    public update."""

    message: str


# --- What the model must answer (OpenAI structured outputs) -------------------


class SummaryOutput(BaseModel):
    summary: str = Field(description="Three to five sentences: the need, what has been done, where it stands.")
    next_steps: list[str] = Field(description="Up to three concrete next steps for the worker. Empty if none.")


class PickedResource(BaseModel):
    resource_id: str = Field(description="The id of a resource from the list, copied exactly.")
    reason: str = Field(description="One sentence on why this resource fits this case.")


class RecommendationOutput(BaseModel):
    picks: list[PickedResource] = Field(description="Up to four resources, best first. Empty if none fit.")


class DraftOutput(BaseModel):
    message: str = Field(description="The message to the requester, plain text, under 120 words.")
