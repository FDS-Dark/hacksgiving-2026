"""Team chat for staff (0032_team_chat_and_delivery.sql): a Team channel,
an On call channel and one channel per case. Never shown to residents."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from models.base import ApiModel


class ChatChannelKind(StrEnum):
    TEAM = "team"
    ONCALL = "oncall"
    CASE = "case"


ChatBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ChatChannel(ApiModel):
    """One channel as the caller sees it. `key` is how routes name it:
    `team`, `oncall`, or the case's id."""

    key: str
    channel: ChatChannelKind
    name: str = Field(description="Team, On call, or Case #1048.")
    case_id: UUID | None = None
    case_number: int | None = None
    case_title: str | None = None
    last_message_at: datetime | None = None
    last_message: str | None = None
    last_author_name: str | None = None
    last_read_at: datetime | None = None
    unread: int = Field(ge=0, description="Messages from others since the caller last read the channel.")
    rapid_unread: int = Field(ge=0, description="Of those, rapid-response ones.")


class ChatMessage(ApiModel):
    id: UUID
    channel: ChatChannelKind
    case_id: UUID | None = None
    author_id: UUID | None = None
    author_name: str | None = None
    body: str
    rapid: bool
    created_at: datetime
    read_by: int = Field(ge=0, description="People other than the author who have read it.")


class ChatThread(ApiModel):
    channel: ChatChannel
    messages: list[ChatMessage] = Field(description="Oldest first.")


class SendChatMessageRequest(ApiModel):
    body: ChatBody
    rapid: bool = Field(
        default=False,
        description="Rapid response: pushes the channel's members (generic lock-screen text only).",
    )


class ChatReadResult(ApiModel):
    last_read_at: datetime
    notifications_read: int


class ChatMember(ApiModel):
    """Who belongs to a channel now (app.chat_members)."""

    user_id: UUID
    last_read_at: datetime | None = None
