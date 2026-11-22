"""Team chat for staff (rapid-response coordination).

Three kinds of channel, named in routes by a key: `team` (every staff
member), `oncall` (whoever is on call now, plus admins; 0015's shifts) and a
case's id (its assignee, whoever opened it, and everyone who has written in
it). Any staff member may read and write any channel; membership decides who
is told about a new message. Residents never reach any of it.

A message gives each other member one inbox row per unread streak (kind
chat_message, never pushed), so the bell and the unread counts move without
paging anyone. A rapid-response message gives each member its own row (kind
chat_rapid) and a push whose text names only the channel. Reading a channel
clears its rows. The message, its read state and its notifications commit
together."""

from datetime import datetime
from typing import Any
from uuid import UUID

from databridge.chat import ChatDatabridge
from databridge.executor import Transactions
from errors import not_found
from models.chat import ChatChannel, ChatChannelKind, ChatMessage, ChatReadResult, ChatThread, SendChatMessageRequest
from models.notification import NotificationKind
from models.staff import StaffMember
from services.notification import NotificationService

NAMES = {ChatChannelKind.TEAM: "Team", ChatChannelKind.ONCALL: "On call"}


def parse_key(key: str) -> tuple[ChatChannelKind, UUID | None]:
    """`team`, `oncall` or a case id; anything else is no channel (404)."""
    if key in (ChatChannelKind.TEAM, ChatChannelKind.ONCALL):
        return ChatChannelKind(key), None
    try:
        return ChatChannelKind.CASE, UUID(key)
    except ValueError:
        raise not_found("channel") from None


def channel_key(channel: ChatChannelKind, case_id: UUID | None) -> str:
    return str(case_id) if channel == ChatChannelKind.CASE else channel.value


def channel_from(row: dict[str, Any]) -> ChatChannel:
    kind = ChatChannelKind(str(row["channel"]))
    case_id = row.get("case_id")
    name = NAMES.get(kind) or f"Case #{row.get('case_number')}"
    return ChatChannel(key=channel_key(kind, case_id), name=name, **row)


class ChatService:
    def __init__(self, chat: ChatDatabridge, notifications: NotificationService, transactions: Transactions) -> None:
        self.chat = chat
        self.notifications = notifications
        self.transactions = transactions

    async def channels(self, worker: StaffMember) -> list[ChatChannel]:
        return [channel_from(row) for row in await self.chat.channels(worker.id)]

    async def _channel(self, worker: StaffMember, key: str) -> ChatChannel:
        kind, case_id = parse_key(key)
        rows = await self.chat.channels(worker.id, kind, case_id)
        if not rows:
            raise not_found("channel")
        return channel_from(rows[0])

    async def thread(self, worker: StaffMember, key: str, before: datetime | None, limit: int) -> ChatThread:
        channel = await self._channel(worker, key)
        messages = await self.chat.messages(channel.channel, channel.case_id, before, limit)
        return ChatThread(channel=channel, messages=messages)

    async def send(self, worker: StaffMember, key: str, body: SendChatMessageRequest) -> ChatMessage:
        kind, case_id = parse_key(key)
        key = channel_key(kind, case_id)  # one spelling per channel, for the dedupe keys
        async with self.transactions.transaction() as tx:
            message = await self.chat.within(tx).send(worker.id, kind, case_id, body.body, body.rapid)
            if message is None:
                raise not_found("case")
            for member in await self.chat.within(tx).members(kind, case_id):
                if member.user_id == worker.id:
                    continue
                if body.rapid:
                    dedupe, notification_kind = f"chat:{key}:rapid:{message.id}", NotificationKind.CHAT_RAPID
                else:
                    # One row per unread streak: a new one only after they have read the channel.
                    since = member.last_read_at.timestamp() if member.last_read_at else 0
                    dedupe, notification_kind = f"chat:{key}:{since:.6f}", NotificationKind.CHAT_MESSAGE
                await self.notifications.notify_chat(
                    tx, user_id=member.user_id, kind=notification_kind, dedupe_key=dedupe, channel=kind.value,
                    case_id=case_id, actor_id=worker.id, push=body.rapid,
                )
        return message

    async def read(self, worker: StaffMember, key: str) -> ChatReadResult:
        channel = await self._channel(worker, key)
        return await self.chat.read(worker.id, channel.channel, channel.case_id)
