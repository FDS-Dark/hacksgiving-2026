"""The in-app inbox (D2/D6 of docs/design/on-call-and-push.md).

Other services call `notify` inside the transaction of the change that
caused it, so the change and its notification commit together. Rows hold
references only; the text a reader sees is rendered here from the facts
app.notification_list returns, which are already limited to what that
reader may see (a resident never gets internal notes or staff names)."""

import logging
from datetime import datetime
from uuid import UUID

from databridge.executor import FunctionCaller, Transactions
from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from errors import ApiError, not_found
from models.case import UpdateType
from models.notification import (
    NotificationFacts,
    NotificationItem,
    NotificationKind,
    NotificationPreferences,
    ReadAllResult,
    UnreadCount,
    UpdateNotificationPreferences,
)
from models.user import AppUser
from services.push_jobs import enqueue_push
from services.request_push import enqueue_request_push

logger = logging.getLogger(__name__)

SNIPPET_LENGTH = 120


def snippet(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= SNIPPET_LENGTH else text[:SNIPPET_LENGTH].rstrip() + "…"


def _case_ref(facts: NotificationFacts) -> str:
    return f"#{facts.case_number}" if facts.case_number is not None else "a case"


def _label(value: str) -> str:
    """in_progress -> In progress"""
    return value.replace("_", " ").capitalize()


CHANNEL_NAMES = {"team": "Team chat", "oncall": "On call chat"}


def chat_route(channel: str | None, case_id: UUID | None) -> str:
    """Where a chat notification opens: /staff/chat/team, /oncall or the case's id."""
    if channel == "case" and case_id:
        return f"/staff/chat/{case_id}"
    return f"/staff/chat/{channel}" if channel in CHANNEL_NAMES else "/staff/chat"


def render(facts: NotificationFacts) -> NotificationItem:
    """The title, body and route the app shows for one notification."""
    n = _case_ref(facts)
    route = f"/staff/cases/{facts.case_id}" if facts.case_id else None
    if facts.kind in (NotificationKind.URGENT_OFFER, NotificationKind.URGENT_UNANSWERED):
        route = f"/staff/alerts/{facts.alert_id}" if facts.alert_id else route
        if facts.kind == NotificationKind.URGENT_OFFER:
            # The app shows the live countdown from the alert itself.
            title, body = f"Urgent: {facts.case_title or 'a case'}", "You're on call. Open it to accept or pass."
        else:
            title, body = f"Nobody has accepted {n}", facts.case_title or ""
    elif facts.kind in (NotificationKind.CHAT_MESSAGE, NotificationKind.CHAT_RAPID):
        route = chat_route(facts.chat_channel, facts.case_id)
        name = CHANNEL_NAMES.get(facts.chat_channel or "", f"the chat on {n}")
        if facts.kind == NotificationKind.CHAT_RAPID:
            title, body = f"Rapid response in {name}", "Open the chat to read it."
        else:
            title, body = f"New messages in {name}", "Open the chat to read them."
    elif facts.kind == NotificationKind.TEST:
        title, body, route = "Test notification", "Push works on this phone.", None
    elif facts.kind == NotificationKind.COMMUNITY_ALERT:
        title, body, route = "Weather alert", "The National Weather Service issued an alert for Milwaukee.", "/alerts"
    elif facts.kind == NotificationKind.ASSIGNMENT:
        title, body = f"{facts.actor_name or 'Someone'} assigned you {n}", facts.case_title or ""
    elif facts.kind == NotificationKind.REPLY:
        title = f"{facts.contact_name or 'The requester'} replied on {n}"
        body = f"“{snippet(facts.update_content)}”" if facts.update_content else ""
    elif facts.kind == NotificationKind.TASK_DUE:
        title, body = "Task due soon", f"{facts.task_title or 'A task'} · {n}"
    elif facts.kind == NotificationKind.REFERRAL_UPDATE:
        status = facts.referral_status.value if facts.referral_status else "updated"
        title, body = f"Referral {status}", f"{facts.resource_name or 'A resource'} · {n}"
    else:  # request_update: the resident's view
        route = f"/help/request/{facts.case_id}" if facts.case_id else None
        if facts.update_type == UpdateType.STATUS_CHANGE or facts.update_content is None:
            title = "Your request was updated"
            body = f"Status: {_label(facts.case_status.value)}" if facts.case_status else ""
        else:
            title, body = "ComForce replied", snippet(facts.update_content)
    return NotificationItem(
        id=facts.id,
        kind=facts.kind,
        title=title,
        body=body,
        case_id=facts.case_id,
        case_number=facts.case_number,
        task_id=facts.task_id,
        alert_id=facts.alert_id,
        route=route,
        created_at=facts.created_at,
        read_at=facts.read_at,
    )


class NotificationService:
    def __init__(self, notifications: NotificationDatabridge, transactions: Transactions) -> None:
        self.notifications = notifications
        self.transactions = transactions

    async def notify(
        self,
        tx: FunctionCaller,
        *,
        user_id: UUID | None,
        kind: NotificationKind,
        dedupe_key: str,
        actor_id: UUID | None,
        case_id: UUID | None = None,
        case_update_id: UUID | None = None,
        task_id: UUID | None = None,
        referral_id: UUID | None = None,
        alert_id: UUID | None = None,
        expires_at: datetime | None = None,
    ) -> bool:
        """One inbox row for `user_id`, inside `tx` (the change's own
        transaction), and its push job (services/push_jobs.py) in the same
        transaction. Nobody to notify, the person who acted, or the same
        event again: no row. True when a row was made. `expires_at`: an
        urgent offer's end, after which its push is dropped."""
        if kind == NotificationKind.REQUEST_UPDATE and user_id is None and case_id and case_update_id:
            # Sent without an account: phones that subscribed with the
            # access code hear of it instead (services/request_push.py).
            await enqueue_request_push(JobDatabridge(tx), case_id, case_update_id)
        if user_id is None or user_id == actor_id:
            return False
        created = await self.notifications.within(tx).create(
            user_id=user_id, kind=kind, dedupe_key=dedupe_key, case_id=case_id, case_update_id=case_update_id,
            task_id=task_id, referral_id=referral_id, actor_id=actor_id, alert_id=alert_id, expires_at=expires_at,
        )
        if created is not None:
            await enqueue_push(JobDatabridge(tx), created.id)
            logger.info("Notification %s (%s) for user %s", created.id, kind.value, user_id)
        return created is not None

    async def notify_chat(
        self,
        tx: FunctionCaller,
        *,
        user_id: UUID,
        kind: NotificationKind,
        dedupe_key: str,
        channel: str,
        case_id: UUID | None,
        actor_id: UUID,
        push: bool,
    ) -> bool:
        """An inbox row about a chat channel, inside `tx`. Only with `push`
        (a rapid-response message) is its push job queued; ordinary messages
        stay in the inbox and the unread counts. True when a row was made."""
        created = await self.notifications.within(tx).create_chat(
            user_id=user_id, kind=kind, dedupe_key=dedupe_key, channel=channel, case_id=case_id, actor_id=actor_id,
        )
        if created is not None and push:
            await enqueue_push(JobDatabridge(tx), created.id)
        return created is not None

    # --- The reader -------------------------------------------------------------

    async def inbox(self, user: AppUser, before: datetime | None, limit: int) -> list[NotificationItem]:
        return [render(f) for f in await self.notifications.list_for(user.id, before, limit)]

    async def get(self, user: AppUser, notification_id: UUID) -> NotificationItem:
        """Opening one marks it read."""
        facts = await self.notifications.get(user.id, notification_id)
        if facts is None:
            raise not_found("notification")
        return render(facts)

    async def unread_count(self, user: AppUser) -> UnreadCount:
        return UnreadCount(count=await self.notifications.unread_count(user.id))

    async def read(self, user: AppUser, notification_id: UUID) -> None:
        if not await self.notifications.read(user.id, notification_id):
            raise not_found("notification")

    async def read_all(self, user: AppUser, case_id: UUID | None) -> ReadAllResult:
        return ReadAllResult(updated=await self.notifications.read_all(user.id, case_id))

    # --- Preferences -------------------------------------------------------------

    async def preferences(self, user: AppUser) -> NotificationPreferences:
        return await self.notifications.preferences(user.id)

    async def update_preferences(
        self, user: AppUser, changes: UpdateNotificationPreferences
    ) -> NotificationPreferences:
        """Only the fields sent change; null clears a quiet time."""
        if not changes.model_fields_set:
            raise ApiError(422, "no_changes", "Send at least one field to change")
        sent = changes.model_dump(include=changes.model_fields_set)
        for field in ("push_enabled", "muted_kinds", "urgent_when_off_call"):
            if field in sent and sent[field] is None:
                raise ApiError(422, "invalid_preferences", f"{field} can't be null")
        async with self.transactions.transaction() as tx:
            prefs = self.notifications.within(tx)
            merged = (await prefs.preferences(user.id)).model_copy(update=sent)
            return await prefs.save_preferences(
                user.id,
                push_enabled=merged.push_enabled,
                muted_kinds=list(dict.fromkeys(merged.muted_kinds)),
                quiet_start=merged.quiet_start,
                quiet_end=merged.quiet_end,
                urgent_when_off_call=merged.urgent_when_off_call,
            )
