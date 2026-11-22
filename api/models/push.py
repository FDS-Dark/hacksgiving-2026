"""Push notifications (services/push.py, services/push_jobs.py): the
devices a person's app registered, the deliveries the worker makes, and the
admin's delivery stats. A push carries no case data (D5)."""

from datetime import datetime, time
from enum import StrEnum
from uuid import UUID

from pydantic import Field

from models.base import ApiModel


class PushPlatform(StrEnum):
    IOS = "ios"  # Android (FCM) later


class PushEnvironment(StrEnum):
    """The APNs host a token belongs to: sandbox for dev builds,
    production for TestFlight and the App Store."""

    SANDBOX = "sandbox"
    PRODUCTION = "production"


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class RegisterDeviceRequest(ApiModel):
    """PUT /v1/me/devices, on every launch and when the token rotates. The
    token is the raw APNs device token, in hex."""

    token: str = Field(pattern=r"^[0-9a-fA-F]{32,200}$")
    platform: PushPlatform = PushPlatform.IOS
    environment: PushEnvironment
    app_version: str | None = Field(default=None, max_length=40)


class PushDevice(ApiModel):
    """A row of app.push_devices."""

    id: UUID
    token: str
    user_id: UUID
    platform: PushPlatform
    environment: PushEnvironment
    app_version: str | None = None
    created_at: datetime
    last_seen_at: datetime
    disabled_at: datetime | None = None
    disabled_reason: str | None = None


class ClaimedDelivery(ApiModel):
    """One device to send a notification to, claimed (now `sending`).
    `was_sending`: a previous attempt may have sent it already (a crash
    between the send and its record), so this is the one resend."""

    delivery_id: UUID
    device_id: UUID
    token: str
    platform: PushPlatform
    environment: PushEnvironment
    attempts: int
    was_sending: bool


class PushFacts(ApiModel):
    """What app.notification_push_facts gives the push job to decide on.
    `kind` is a plain string: the job treats kinds it doesn't know as
    ordinary updates."""

    id: UUID
    user_id: UUID
    kind: str
    case_id: UUID | None = None
    created_at: datetime
    read_at: datetime | None = None
    expires_at: datetime | None = None
    push_enabled: bool = True
    muted_kinds: list[str] = Field(default_factory=list)
    quiet_start: time | None = None
    quiet_end: time | None = None
    timezone: str = "UTC"
    reader_is_staff: bool
    unread_count: int = 0
    recent_push_count: int = 0
    last_case_push_at: datetime | None = None


class ReasonCount(ApiModel):
    reason: str
    count: int


class NotificationStats(ApiModel):
    """GET /v1/notifications/stats (admins): push deliveries since `since`
    by status, devices, and the most common APNs failure reasons."""

    since: datetime
    deliveries: dict[DeliveryStatus, int]
    active_devices: int
    disabled_devices: int
    top_reasons: list[ReasonCount]


class SubscribeRequestPush(ApiModel):
    """POST /v1/public/requests/{number}/devices: this phone hears about one
    request sent without an account."""

    token: str = Field(pattern=r"^[0-9a-fA-F]{32,200}$")
    platform: PushPlatform = PushPlatform.IOS
    environment: PushEnvironment


class RequestPushTarget(ApiModel):
    """A phone subscribed to a request (app.request_push_subscriptions)."""

    id: UUID
    token: str
    environment: str
