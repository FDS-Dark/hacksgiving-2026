"""The push job (D4 of docs/design/on-call-and-push.md). Every new inbox row
queues one `notification.push` job (NotificationService.notify, in the same
transaction); the worker runs it:

    load the notification, its person's preferences and push counts
      read, muted, push off            -> skipped (the inbox still has it)
      non-urgent only:
        quiet hours                    -> a job `notification:{id}:after-quiet` at their end
        pushed about this case < 2 min -> skipped (coalesced)
        20 pushes this hour already    -> skipped (capped)
    claim one delivery per active device (pending -> sending, committed)
    one POST per device, each answer recorded as it comes:
      200                              -> sent
      410, BadDeviceToken, DeviceTokenNotForTopic -> failed, device disabled
      429, 5xx, 403, no answer         -> pending again; the job fails and retries
      any other 4xx                    -> failed (our bug: logged at ERROR)

This stage breaks the "`run` only reads" rule of services/pipeline.py on
purpose: the send is the side effect, so the claim must be durable before
it, and each answer is recorded at once (the runner only runs `finish` on
success). `finish` only queues the after-quiet job. A delivery left in
`sending` by a crash is resent once on the retry, with the same collapse id,
so the phone shows one notification.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from adapters.push import PushMessage, PushProvider, PushResult
from databridge.executor import FunctionCaller
from databridge.job import JobDatabridge
from databridge.push import PushDatabridge
from models.job import Job
from models.push import ClaimedDelivery, DeliveryStatus, PushFacts
from services.pipeline import Finish

logger = logging.getLogger(__name__)

NOTIFICATION_PUSH = "notification.push"

URGENT_KINDS = frozenset({"urgent_offer", "urgent_unanswered"})
COALESCE_WINDOW = timedelta(minutes=2)
HOURLY_CAP = 20
DEFAULT_EXPIRY = timedelta(hours=24)

UPDATE_TITLES = {
    "assignment": "New assignment",
    "reply": "New reply",
    "task_due": "Task due soon",
    "referral_update": "Referral update",
}
UPDATE_BODY = "Open the app to see it."
RESIDENT_BODY = "You have a new update."

# APNs reasons that mean the token is dead for this app and environment.
DEAD_TOKEN_REASONS = frozenset({"BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered", "ExpiredToken"})


async def enqueue_push(
    jobs: JobDatabridge, notification_id: UUID, *, run_at: datetime | None = None, after_quiet: bool = False
) -> None:
    """Queue the push for a new notification. Twice for the same one is one job."""
    payload: dict[str, str | bool] = {"notification_id": str(notification_id)}
    key = f"notification:{notification_id}"
    if after_quiet:
        payload["after_quiet"] = True
        key += ":after-quiet"
    await jobs.enqueue(NOTIFICATION_PUSH, payload, run_at=run_at, dedupe_key=key)


# --- What to send ------------------------------------------------------------------


def message_for(facts: PushFacts, now: datetime) -> PushMessage:
    """The push for one notification: fixed strings per kind, nothing about
    the case (D5)."""
    expiration = int((now + DEFAULT_EXPIRY).timestamp())
    if facts.kind in URGENT_KINDS:
        offer = facts.kind == "urgent_offer"
        if offer and facts.expires_at is not None:
            expiration = int(facts.expires_at.timestamp())
        return PushMessage(
            notification_id=facts.id,
            title="Urgent request" if offer else "Urgent request waiting",
            body="You're on call. Open the app to respond." if offer else "Nobody has accepted yet.",
            urgent=True, priority=10, expiration=expiration, thread_id="urgent",
            interruption_level="time-sensitive", sound=True,
        )
    if facts.kind == "test":
        return PushMessage(
            notification_id=facts.id, title="Test notification", body="Push works on this phone.", urgent=False,
            priority=10, expiration=expiration, thread_id="updates", interruption_level="active", sound=True,
        )
    if facts.kind == "community_alert":
        # Public information, nothing about the person; still silent (D5).
        return PushMessage(
            notification_id=facts.id, title="Weather alert", body="Open the app for details.", urgent=False,
            priority=5, expiration=expiration, thread_id="updates", interruption_level="active", sound=False,
        )
    if facts.kind == "request_update" or not facts.reader_is_staff:
        # A resident: no title, no sound, no badge.
        return PushMessage(
            notification_id=facts.id, title=None, body=RESIDENT_BODY, urgent=False, priority=5,
            expiration=expiration, thread_id="updates", interruption_level="active", sound=False,
        )
    return PushMessage(
        notification_id=facts.id, title=UPDATE_TITLES.get(facts.kind, "New update"), body=UPDATE_BODY,
        urgent=False, priority=5, expiration=expiration, thread_id="updates", interruption_level="active",
        sound=True, badge=facts.unread_count,
    )


# --- Whether to send ----------------------------------------------------------------


def person_zone(name: str, fallback: ZoneInfo) -> ZoneInfo:
    """The person's zone; while it is still the default UTC (or unknown),
    the org's."""
    if name == "UTC":
        return fallback
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return fallback


def quiet_until(now: datetime, start: time | None, end: time | None, zone: ZoneInfo) -> datetime | None:
    """When quiet hours end, if `now` is inside them; None otherwise. The
    window may cross midnight (21:00 to 07:00)."""
    if start is None or end is None or start == end:
        return None
    local = now.astimezone(zone)
    at = local.time().replace(tzinfo=None)
    if start < end:
        inside, end_day = start <= at < end, local.date()
    else:
        inside = at >= start or at < end
        end_day = local.date() + timedelta(days=1) if at >= start else local.date()
    if not inside:
        return None
    return datetime.combine(end_day, end, tzinfo=zone).astimezone(timezone.utc)


@dataclass(frozen=True)
class Decision:
    """send, skip (with why) or defer (until quiet hours end)."""

    action: str
    reason: str | None = None
    until: datetime | None = None


SEND = Decision("send")


def decide(facts: PushFacts, now: datetime, fallback_zone: ZoneInfo, *, after_quiet: bool = False) -> Decision:
    if facts.read_at is not None:
        return Decision("skip", "read")
    if facts.kind == "test":  # asked for just now: it always goes
        return SEND
    if facts.kind in URGENT_KINDS:
        # Being on call (or opting in to the fallback) is the opt-in: urgent
        # pages ignore push-off, mutes, quiet hours and the caps (D3/D4).
        if facts.expires_at is not None and facts.expires_at <= now:
            return Decision("skip", "expired")
        return SEND
    if not facts.push_enabled:
        return Decision("skip", "push_off")
    if facts.kind in facts.muted_kinds:
        return Decision("skip", "muted")
    if not after_quiet:  # the deferred job must not defer again (its key is live)
        until = quiet_until(now, facts.quiet_start, facts.quiet_end, person_zone(facts.timezone, fallback_zone))
        if until is not None:
            return Decision("defer", until=until)
    if facts.last_case_push_at is not None and now - facts.last_case_push_at < COALESCE_WINDOW:
        return Decision("skip", "coalesced")
    if facts.recent_push_count >= HOURLY_CAP:
        return Decision("skip", "hourly_cap")
    return SEND


# --- What APNs said -----------------------------------------------------------------


def outcome(result: PushResult) -> str:
    """sent, disable (the token is dead), retry, or failed (for good)."""
    code, reason = result.status_code, result.reason
    if code == 200:
        return "sent"
    if code == 410 or (code == 400 and reason in DEAD_TOKEN_REASONS):
        return "disable"
    if code == 0 or code == 429 or code >= 500 or code == 403:
        return "retry"
    return "failed"


class PushRetry(Exception):
    """Some deliveries got a retryable answer; they are pending again."""


class PushStage:
    kind = NOTIFICATION_PUSH
    # Two 10 s requests at most per device (one token renewal), concurrently.
    timeout = 30.0

    def __init__(
        self,
        push: PushDatabridge,
        jobs: JobDatabridge,
        provider: PushProvider | None,
        fallback_zone: ZoneInfo,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self.push = push
        self.jobs = jobs
        self.provider = provider
        self.fallback_zone = fallback_zone
        self.clock = clock

    async def run(self, job: Job) -> Finish:
        notification_id = UUID(str(job.payload["notification_id"]))
        if self.provider is None:
            # Push is off on this worker: inbox only.
            await self.push.skip(notification_id, "provider_off")
            return _nothing
        facts = await self.push.facts(notification_id)
        if facts is None:
            return _nothing
        now = self.clock()
        decision = decide(facts, now, self.fallback_zone, after_quiet=bool(job.payload.get("after_quiet")))
        if decision.action == "skip":
            await self.push.skip(notification_id, decision.reason or "skipped")
            return _nothing
        if decision.action == "defer":
            return self._defer(notification_id, decision.until)

        claimed = await self.push.claim(notification_id)  # committed before any send
        if not claimed:
            return _nothing
        message = message_for(facts, now)
        outcomes = await asyncio.gather(*(self._send(self.provider, d, message) for d in claimed))
        retry = outcomes.count("retry")
        if retry:
            raise PushRetry(f"{retry} of {len(claimed)} deliveries to retry")
        return _nothing

    def _defer(self, notification_id: UUID, until: datetime | None) -> Finish:
        async def finish(tx: FunctionCaller) -> None:
            await enqueue_push(self.jobs.within(tx), notification_id, run_at=until, after_quiet=True)

        return finish

    async def _send(self, provider: PushProvider, delivery: ClaimedDelivery, message: PushMessage) -> str:
        """One device: send, then record the answer at once."""
        try:
            result = await provider.send(delivery, message)
        except Exception as error:  # one device's failure never loses the others' answers
            result = PushResult(0, type(error).__name__)
        result_outcome = outcome(result)
        n, device = message.notification_id, delivery.device_id
        if result_outcome == "sent":
            await self.push.record(delivery.delivery_id, DeliveryStatus.SENT, apns_id=result.apns_id)
            logger.info("Push for notification %s sent to device %s%s", n, device,
                        " (resent)" if delivery.was_sending else "")
        elif result_outcome == "disable":
            await self.push.record(delivery.delivery_id, DeliveryStatus.FAILED, reason=result.reason)
            await self.push.disable(device, result.reason or f"http_{result.status_code}")
            logger.info("Device %s disabled: APNs said %s %s", device, result.status_code, result.reason)
        elif result_outcome == "retry":
            await self.push.record(delivery.delivery_id, DeliveryStatus.PENDING, reason=result.reason)
            level = logging.ERROR if result.status_code == 403 or result.reason == "TooManyProviderTokenUpdates" \
                else logging.WARNING
            logger.log(level, "Push for notification %s to device %s will be retried: %s %s",
                       n, device, result.status_code, result.reason)
        else:
            await self.push.record(delivery.delivery_id, DeliveryStatus.FAILED, reason=result.reason)
            logger.error("APNs refused the push for notification %s: %s %s", n, result.status_code, result.reason)
        return result_outcome

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        await self.push.give_up(UUID(str(job.payload["notification_id"])))


async def _nothing(_: FunctionCaller) -> None:
    return None
