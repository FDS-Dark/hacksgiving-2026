"""Team chat (0032_team_chat_and_delivery.sql)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from databridge.base import Databridge
from models.chat import ChatChannelKind, ChatMember, ChatMessage, ChatReadResult


class ChatDatabridge(Databridge):
    async def channels(
        self, user_id: UUID, channel: ChatChannelKind | None = None, case_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Raw rows: the service names each channel."""
        return await self._rows("chat_channel_list", user_id=user_id, channel=channel, case_id=case_id)

    async def messages(
        self, channel: ChatChannelKind, case_id: UUID | None, before: datetime | None, limit: int
    ) -> list[ChatMessage]:
        rows = await self._rows("chat_message_list", channel=channel, case_id=case_id, before=before, limit=limit)
        return [ChatMessage(**row) for row in rows]

    async def send(
        self, author_id: UUID, channel: ChatChannelKind, case_id: UUID | None, body: str, rapid: bool
    ) -> ChatMessage | None:
        row = await self._first(
            "chat_message_create", author_id=author_id, channel=channel, case_id=case_id, body=body, rapid=rapid
        )
        return ChatMessage(**row) if row else None

    async def members(self, channel: ChatChannelKind, case_id: UUID | None) -> list[ChatMember]:
        return [ChatMember(**row) for row in await self._rows("chat_members", channel=channel, case_id=case_id)]

    async def read(self, user_id: UUID, channel: ChatChannelKind, case_id: UUID | None) -> ChatReadResult:
        return ChatReadResult(**await self._one("chat_read", user_id=user_id, channel=channel, case_id=case_id))
