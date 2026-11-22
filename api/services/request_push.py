"""Push for requests sent without an account (on-call-and-push.md D5,
question 7: decided yes). A phone subscribes to one request with its number
and access code. The code already opens the whole public thread, so a
subscription gives whoever holds it nothing more, and the push says only
"You have a new update", silently. At most 3 phones per request.

Every public update on a request (a staff message, a status change) goes
through NotificationService.notify, which queues one `request.push` job per
update for these phones. No inbox row: there is no account to hold one.
The payload carries the request's id ("r") so the app can open it.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from adapters.push import PushMessage, PushProvider, PushResult
from databridge.executor import FunctionCaller
from databridge.job import JobDatabridge
from databridge.request_push import RequestPushDatabridge
from errors import not_found
from models.job import Job
from models.push import RequestPushTarget, SubscribeRequestPush
from services import access_code
from services.pipeline import Finish
from services.push_jobs import RESIDENT_BODY, outcome

logger = logging.getLogger(__name__)

REQUEST_PUSH = "request.push"
EXPIRY = timedelta(hours=24)


async def enqueue_request_push(jobs: JobDatabridge, case_id: UUID, case_update_id: UUID) -> None:
    """Queue the push to phones subscribed to `case_id`, for one update.
    Twice for the same update is one job."""
    await jobs.enqueue(
        REQUEST_PUSH, {"case_id": str(case_id), "case_update_id": str(case_update_id)},
        dedupe_key=f"request-push:{case_update_id}",
    )


def request_message(case_id: UUID, case_update_id: UUID, now: datetime) -> PushMessage:
    """The same push a signed-in resident gets (D5): no title, no sound."""
    return PushMessage(
        notification_id=case_update_id, title=None, body=RESIDENT_BODY, urgent=False, priority=5,
        expiration=int((now + EXPIRY).timestamp()), thread_id="updates", interruption_level="active",
        sound=False, request_id=case_id,
    )


class RequestPushService:
    def __init__(self, subscriptions: RequestPushDatabridge) -> None:
        self.subscriptions = subscriptions

    async def subscribe(self, number: int, code: str, body: SubscribeRequestPush) -> None:
        """404 for a wrong number or code alike."""
        case_id = await self.subscriptions.subscribe(
            number, access_code.hash_code(code), body.token, body.platform.value, body.environment.value
        )
        if case_id is None:
            raise not_found("request")

    async def unsubscribe(self, number: int, code: str, token: str) -> None:
        await self.subscriptions.unsubscribe(number, access_code.hash_code(code), token)


async def _nothing(_: FunctionCaller) -> None:
    return None


class RequestPushRetry(Exception):
    """Some phones got a retryable answer. The job runs again; the phones
    that got it see the resend replace it (same collapse id)."""


class RequestPushStage:
    kind = REQUEST_PUSH
    timeout = 30.0

    def __init__(self, subscriptions: RequestPushDatabridge, provider: PushProvider | None) -> None:
        self.subscriptions = subscriptions
        self.provider = provider

    async def run(self, job: Job) -> Finish:
        if self.provider is None:
            return _nothing
        case_id, update_id = UUID(str(job.payload["case_id"])), UUID(str(job.payload["case_update_id"]))
        targets = await self.subscriptions.targets(case_id)
        message = request_message(case_id, update_id, datetime.now(timezone.utc))
        outcomes = await asyncio.gather(*(self._send(self.provider, t, message) for t in targets))
        retry = outcomes.count("retry")
        if retry:
            raise RequestPushRetry(f"{retry} of {len(targets)} phones to retry")
        return _nothing

    async def _send(self, provider: PushProvider, target: RequestPushTarget, message: PushMessage) -> str:
        try:
            result = await provider.send(target, message)
        except Exception as error:
            result = PushResult(0, type(error).__name__)
        result_outcome = outcome(result)
        if result_outcome == "disable":
            await self.subscriptions.disable(target.id, result.reason or f"http_{result.status_code}")
            logger.info("Request subscription %s disabled: APNs said %s", target.id, result.reason)
        elif result_outcome == "failed":
            logger.error("APNs refused a request push: %s %s", result.status_code, result.reason)
        return result_outcome

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        return None
