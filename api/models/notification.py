"""The in-app inbox (services/notification.py): notifications about cases,
replies, tasks and referrals, and each person's notification settings."""

from datetime import datetime, time
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import Field, PlainSerializer

from models.base import ApiModel
from models.case import CaseStatus, ReferralStatus, UpdateType


class NotificationKind(StrEnum):
    ASSIGNMENT = "assignment"
    REPLY = "reply"
    REQUEST_UPDATE = "request_update"
    TASK_DUE = "task_due"
    REFERRAL_UPDATE = "referral_update"
    # A push the person sent themselves (POST /v1/notifications/test).
    TEST = "test"
    # An urgent case offered to you on call (services/oncall_jobs.py).
    URGENT_OFFER = "urgent_offer"
    # Nobody accepted an urgent case (admins, at most 3 times).
    URGENT_UNANSWERED = "urgent_unanswered"
    # A serious weather alert, to residents who opted in (services/weather_jobs.py).
    COMMUNITY_ALERT = "community_alert"
    # New team-chat messages since you last read a channel: inbox only, never pushed.
    CHAT_MESSAGE = "chat_message"
    # A rapid-response chat message: pushed (generic text) to the channel's members.
    CHAT_RAPID = "chat_rapid"


class StoredNotification(ApiModel):
    """A row of app.notifications: references only, no text."""

    id: UUID
    user_id: UUID
    kind: NotificationKind
    case_id: UUID | None = None
    case_update_id: UUID | None = None
    task_id: UUID | None = None
    referral_id: UUID | None = None
    # urgent_* rows: which on-call alert.
    alert_id: UUID | None = None
    actor_id: UUID | None = None
    dedupe_key: str
    created_at: datetime
    read_at: datetime | None = None
    # An urgent offer's end (the push's apns-expiration).
    expires_at: datetime | None = None


class NotificationFacts(ApiModel):
    """What app.notification_list gives the service to render one item:
    only what the reader may see (staff-only facts are None for a
    resident)."""

    id: UUID
    kind: NotificationKind
    case_id: UUID | None = None
    case_number: int | None = None
    case_title: str | None = None
    case_status: CaseStatus | None = None
    task_id: UUID | None = None
    task_title: str | None = None
    reader_is_staff: bool
    update_type: UpdateType | None = None
    update_content: str | None = None
    actor_name: str | None = None
    contact_name: str | None = None
    referral_status: ReferralStatus | None = None
    resource_name: str | None = None
    alert_id: UUID | None = None
    # chat_* rows: team, oncall or case (the case is case_id).
    chat_channel: str | None = None
    created_at: datetime
    read_at: datetime | None = None


class NotificationItem(ApiModel):
    """One row of the inbox, ready to show. `route` is where the app goes
    when it's tapped."""

    id: UUID
    kind: NotificationKind
    title: str
    body: str
    case_id: UUID | None = None
    case_number: int | None = None
    task_id: UUID | None = None
    # urgent_offer and urgent_unanswered: the alert to accept or pass.
    alert_id: UUID | None = None
    route: str | None = None
    created_at: datetime
    read_at: datetime | None = None


class UnreadCount(ApiModel):
    count: int


class ReadAllRequest(ApiModel):
    """Without `case_id`, everything; with it, only that case's rows (the
    app sends it when a case or request screen opens)."""

    case_id: UUID | None = None


class ReadAllResult(ApiModel):
    updated: int


# "21:00", the way the app shows and sends it.
ClockTime = Annotated[time, PlainSerializer(lambda t: t.strftime("%H:%M"), return_type=str)]


class NotificationPreferences(ApiModel):
    """Push settings (push arrives in phase 2). The inbox ignores them: it
    always gets the row."""

    push_enabled: bool = True
    muted_kinds: list[NotificationKind] = Field(default_factory=list)
    quiet_start: ClockTime | None = None
    quiet_end: ClockTime | None = None
    urgent_when_off_call: bool = False


class UpdateNotificationPreferences(ApiModel):
    """Only the fields sent change; `quiet_start: null` clears it."""

    push_enabled: bool | None = None
    muted_kinds: list[NotificationKind] | None = Field(default=None, max_length=20)
    quiet_start: time | None = None
    quiet_end: time | None = None
    urgent_when_off_call: bool | None = None
