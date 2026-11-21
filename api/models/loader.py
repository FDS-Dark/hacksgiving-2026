"""What the data loader (api/loader) imports, and what each write did. Not
part of the HTTP contract: the loader runs as a batch job, not behind the
API.

The text limits match the columns' checks and the API's own request models,
so a long title from a source is cut to fit rather than failing the row."""

import logging
import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, TypeVar

from pydantic import BaseModel, BeforeValidator, Field, ValidationError

from models.case_enums import CaseCategory
from models.opportunity import Audience, Cost, OpportunityKind

logger = logging.getLogger(__name__)

_SPACE = re.compile(r"\s+")


def _clip(limit: int) -> BeforeValidator:
    """Collapse whitespace and cut to `limit` characters (an ellipsis marks a
    cut). Blank becomes None, so an optional field stays empty."""

    def clip(value: object) -> object:
        if value is None:
            return None
        text = _SPACE.sub(" ", str(value)).strip()
        if not text:
            return None
        return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"

    return BeforeValidator(clip)


_WEB_URL = re.compile(r"^https?://\S+$")


def _web_url(value: object) -> object:
    """A link the source got wrong is left out rather than failing the row."""
    if value is None:
        return None
    text = str(value).strip()
    return text if len(text) <= 500 and _WEB_URL.fullmatch(text) else None


Name = Annotated[str, _clip(160), Field(min_length=1)]
Short = Annotated[str | None, _clip(160)]
Place = Annotated[str | None, _clip(300)]
Body = Annotated[str | None, _clip(4000)]
WebUrl = Annotated[str | None, BeforeValidator(_web_url)]
SOURCE_PATTERN = r"^[a-z][a-z0-9_]{0,31}$"


class ImportedOpportunity(BaseModel):
    source: str = Field(pattern=SOURCE_PATTERN)
    external_id: Annotated[str, Field(min_length=1, max_length=200)]
    kind: OpportunityKind
    title: Name
    organization: Name
    description: Body = None
    location: Place = None
    schedule: Short = None
    pay: Short = None
    contact_phone: Short = None
    contact_email: Short = None
    apply_url: WebUrl = None
    audiences: list[Audience] = Field(default_factory=list)
    cost: Cost | None = None
    posted_at: datetime | None = None
    expires_at: datetime | None = None


class ImportedResource(BaseModel):
    source: str = Field(pattern=SOURCE_PATTERN)
    external_id: Annotated[str, Field(min_length=1, max_length=200)]
    name: Name
    category: CaseCategory
    description: Body = None
    address: Place = None
    neighborhood: Short = None
    phone: Short = None
    website: WebUrl = None
    hours: Short = None
    latitude: Annotated[float | None, Field(ge=-90, le=90)] = None
    longitude: Annotated[float | None, Field(ge=-180, le=180)] = None


class SyncResult(StrEnum):
    INSERTED = "inserted"
    UPDATED = "updated"
    UNCHANGED = "unchanged"
    DUPLICATE = "duplicate"


Imported = TypeVar("Imported", ImportedOpportunity, ImportedResource)


def try_build(model: type[Imported], **fields: Any) -> Imported | None:
    """The row, or None (logged) when the source's data doesn't fit: one bad
    row is skipped, the rest of the source still loads."""
    try:
        return model(**fields)
    except ValidationError as exc:
        fields_wrong = ", ".join(sorted({str(e["loc"][0]) for e in exc.errors() if e["loc"]}))
        logger.warning("Skipping a %s row from %s: %s", model.__name__, fields.get("source"), fields_wrong)
        return None
