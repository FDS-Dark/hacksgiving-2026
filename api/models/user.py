"""The user domain: who is calling."""

from datetime import datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import StringConstraints, field_validator

from models.base import ApiModel

DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class TokenClaims(ApiModel):
    """The verified access token's identity claims. `sub` is Auth0's subject
    string; it is mapped to an internal user id and never used as one."""

    sub: str
    name: str | None = None


class AppUser(ApiModel):
    """The authenticated caller as a Hacksgiving user (app.users)."""

    id: UUID
    auth0_sub: str
    display_name: str | None = None
    timezone: str
    created_at: datetime


class UpdateMeRequest(ApiModel):
    display_name: DisplayName | None = None
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown IANA timezone")
        return value
