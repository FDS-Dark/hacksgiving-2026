"""AI help for workers: summaries, resource suggestions and draft messages.
Every result is a suggestion a worker reads first; nothing here changes a
case."""

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

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


class ResourceOutcomes(ApiModel):
    """How referrals to this resource have turned out so far."""

    referred: int
    helped: int = Field(description="Accepted or completed.")
    declined: int
    success_rate: float | None = Field(
        default=None, description="helped / (helped + declined), once at least one has been decided."
    )


class NearbyStop(ApiModel):
    """The closest MCTS bus stop to the resource (within about half a mile)."""

    name: str
    routes: list[str]
    distance_m: int


class ResourceSuggestion(ApiModel):
    resource: Resource
    reason: str
    outcomes: ResourceOutcomes | None = None
    nearest_stop: NearbyStop | None = None


class ResourceSuggestions(ApiModel):
    method: SuggestionMethod
    suggestions: list[ResourceSuggestion]


# Languages staff can reply in: Milwaukee's most common, by ISO 639 code.
LANGUAGES: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "hmn": "Hmong",
    "ar": "Arabic",
    "so": "Somali",
    "my": "Burmese",
    "ps": "Pashto",
    "fa": "Dari / Persian",
    "uk": "Ukrainian",
    "ru": "Russian",
    "zh": "Chinese",
    "vi": "Vietnamese",
    "fr": "French",
    "sw": "Swahili",
    "pt": "Portuguese",
    "ne": "Nepali",
    "lo": "Lao",
    "tl": "Tagalog",
}

LanguageCode = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[a-z]{2,3}$")]


class LanguageSource(StrEnum):
    STAFF = "staff"
    DETECTED = "detected"


class CaseLanguage(ApiModel):
    """The language to reply to the resident in. `language: null`: not set
    (English until someone sets it or the AI notices otherwise)."""

    language: str | None = None
    language_name: str | None = None
    source: LanguageSource | None = None


class SetCaseLanguageRequest(ApiModel):
    language: LanguageCode | None = Field(description="An ISO 639 code from `GET /cases/languages`; null clears it.")


class LanguageOption(ApiModel):
    code: str
    name: str


class DraftMessageRequest(ApiModel):
    language: LanguageCode | None = Field(
        default=None, description="Write it in this language. Default: the case's language, else the resident's own."
    )


class DraftMessage(ApiModel):
    """A message to the requester. Sent only if a worker posts it as a
    public update."""

    message: str
    language: str = Field(default="en", description="The language `message` is in (ISO 639).")
    english: str | None = Field(
        default=None, description="An English version for the worker, when `message` isn't English."
    )


class TranslateRequest(ApiModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    language: LanguageCode | None = Field(default=None, description="Default: the case's language.")


class Translation(ApiModel):
    text: str
    language: str


class TranslateOutput(BaseModel):
    text: str = Field(description="The message translated, plain text, same meaning and tone, nothing added.")


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
    language: str = Field(description="The ISO 639 code of the language `message` is written in, e.g. en, es, hmn.")
    english: str = Field(description="The same message in English (identical to `message` if it is English).")
