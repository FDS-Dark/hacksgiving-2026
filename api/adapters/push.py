"""Push notifications, sent by the worker only (services/push_jobs.py). Two
providers, one interface (`PushProvider`), as in adapters/storage.py:

- `ApnsPushProvider`: straight to Apple (APNs), one HTTP/2 POST per device on
  one long-lived connection. Auth is a provider token: an ES256 JWT signed
  with the team's .p8 key, cached and renewed every 50 minutes (Apple
  rejects one older than an hour and throttles renewing more often than
  every 20 minutes).
- `FakePushProvider`: records what it was asked to send; tests script its
  answers.

What a push says is fixed per kind (D5 of docs/design/on-call-and-push.md):
no case title, name, number or message text, only fixed strings plus the
notification id (`n`) and whether it is urgent (`u`). Android (FCM) comes
later behind the same protocol.
"""

import json
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

import httpx
import jwt

from settings import PushConfig

logger = logging.getLogger(__name__)

APNS_HOSTS = {
    "production": "https://api.push.apple.com",
    "sandbox": "https://api.sandbox.push.apple.com",
}
# Renew the provider token after this many seconds (Apple: 20 to 60 minutes).
TOKEN_RENEW_SECONDS = 50 * 60
TOKEN_MIN_RENEW_SECONDS = 20 * 60
# A 403 with one of these: renew the provider token and try once more.
TOKEN_REASONS = frozenset({"ExpiredProviderToken", "InvalidProviderToken"})
# Below the push stage's timeout, so one slow device can't use it all.
REQUEST_TIMEOUT_SECONDS = 10.0


class PushDestination(Protocol):
    """A device to send to: its token and APNs environment."""

    @property
    def token(self) -> str: ...

    @property
    def environment(self) -> str: ...


@dataclass(frozen=True)
class PushMessage:
    """One push, ready to send. Only fixed strings (D5)."""

    notification_id: UUID
    title: str | None
    body: str
    urgent: bool
    priority: int  # 10 now, 5 when convenient for the phone
    expiration: int  # UNIX seconds; APNs drops it after this
    thread_id: str  # "urgent" or "updates", never per case
    interruption_level: str  # "time-sensitive" or "active"
    sound: bool
    badge: int | None = None
    # A request sent without an account (services/request_push.py): the
    # app opens it from this, since there is no inbox row to look up.
    request_id: UUID | None = None

    @property
    def collapse_id(self) -> str:
        """A resend replaces the shown notification instead of stacking."""
        return str(self.notification_id)


@dataclass(frozen=True)
class PushResult:
    """APNs' answer. status_code 0: no answer (a network error or timeout),
    with the error's type as `reason`."""

    status_code: int
    reason: str | None = None
    apns_id: str | None = None


class PushProvider(Protocol):
    async def send(self, device: PushDestination, message: PushMessage) -> PushResult: ...

    async def close(self) -> None: ...


def apns_payload(message: PushMessage) -> dict[str, Any]:
    alert: dict[str, str] = {"body": message.body}
    if message.title is not None:
        alert = {"title": message.title, "body": message.body}
    aps: dict[str, Any] = {
        "alert": alert,
        "interruption-level": message.interruption_level,
        "thread-id": message.thread_id,
    }
    if message.sound:
        aps["sound"] = "default"
    if message.badge is not None:
        aps["badge"] = message.badge
    payload: dict[str, Any] = {"aps": aps, "n": str(message.notification_id), "u": 1 if message.urgent else 0}
    if message.request_id is not None:
        payload["r"] = str(message.request_id)
    return payload


def apns_headers(message: PushMessage, topic: str, bearer: str) -> dict[str, str]:
    return {
        "authorization": f"bearer {bearer}",
        "apns-push-type": "alert",
        "apns-priority": str(message.priority),
        "apns-expiration": str(message.expiration),
        "apns-collapse-id": message.collapse_id,
        "apns-topic": topic,
    }


class ProviderToken:
    """The APNs provider token: ES256, header `kid`, claims `iss` and `iat`.
    Cached; renewed after 50 minutes, or when APNs rejects it."""

    def __init__(self, key: str, key_id: str, team_id: str, clock: Callable[[], float] = time.time) -> None:
        self._key = key
        self._key_id = key_id
        self._team_id = team_id
        self._clock = clock
        self._token: str | None = None
        self._issued_at = 0.0

    def current(self) -> str:
        if self._token is None or self._clock() - self._issued_at >= TOKEN_RENEW_SECONDS:
            self._issue()
        assert self._token is not None
        return self._token

    def renew(self, rejected: str) -> str:
        """A new token, unless another request already renewed the rejected
        one (renewing too often gets 429 TooManyProviderTokenUpdates)."""
        # Apple allows a new token at most every 20 minutes: a rejection of
        # a younger one (a bad key, say) is retried with the same token and
        # fails, rather than tripping TooManyProviderTokenUpdates.
        if self._token == rejected and self._clock() - self._issued_at >= TOKEN_MIN_RENEW_SECONDS:
            self._issue()
        return self.current()

    def _issue(self) -> None:
        now = self._clock()
        self._token = jwt.encode(
            {"iss": self._team_id, "iat": int(now)}, self._key, algorithm="ES256", headers={"kid": self._key_id}
        )
        self._issued_at = now


def _reason(response: httpx.Response) -> str | None:
    if response.status_code == 200:
        return None
    try:
        reason = json.loads(response.content or b"{}").get("reason")
    except (ValueError, AttributeError):
        reason = None
    return str(reason)[:100] if reason else None


class ApnsPushProvider:
    def __init__(
        self, token: ProviderToken, topic: str, client: httpx.AsyncClient | None = None
    ) -> None:
        self.token = token
        self.topic = topic
        # One HTTP/2 connection per host, multiplexing every request.
        self._client = client or httpx.AsyncClient(http2=True, timeout=REQUEST_TIMEOUT_SECONDS)

    async def send(self, device: PushDestination, message: PushMessage) -> PushResult:
        bearer = self.token.current()
        result = await self._post(device, message, bearer)
        if result.status_code == 403 and result.reason in TOKEN_REASONS:
            logger.warning("APNs rejected the provider token (%s); renewing it", result.reason)
            result = await self._post(device, message, self.token.renew(bearer))
        return result

    async def _post(self, device: PushDestination, message: PushMessage, bearer: str) -> PushResult:
        url = f"{APNS_HOSTS[device.environment]}/3/device/{device.token}"
        try:
            response = await self._client.post(
                url, headers=apns_headers(message, self.topic, bearer), content=json.dumps(apns_payload(message))
            )
        except httpx.HTTPError as error:
            return PushResult(0, type(error).__name__)
        return PushResult(response.status_code, _reason(response), response.headers.get("apns-id"))

    async def close(self) -> None:
        await self._client.aclose()


Script = PushResult | Callable[[PushDestination, PushMessage], PushResult]


@dataclass
class FakePushProvider:
    """Accepts everything (200), unless a test queued other answers in
    `results` (used in order, one per send)."""

    sent: list[tuple[PushDestination, PushMessage]] = field(default_factory=list)
    results: list[Script] = field(default_factory=list)

    async def send(self, device: PushDestination, message: PushMessage) -> PushResult:
        self.sent.append((device, message))
        if self.results:
            script = self.results.pop(0)
            return script(device, message) if callable(script) else script
        return PushResult(200, None, str(uuid.uuid4()).upper())

    async def close(self) -> None:
        return None


def make_push_provider(config: PushConfig) -> PushProvider | None:
    """The configured provider, or None (push off: inbox only)."""
    if config.provider == "off":
        return None
    if config.provider == "fake":
        logger.info("Push provider: fake (nothing leaves this machine)")
        return FakePushProvider()
    key = config.signing_key()
    if not (key and config.apns_key_id and config.apns_team_id):
        logger.warning(
            "APP__PUSH__PROVIDER is apns but the key, key id or team id is missing: push is off (inbox only)"
        )
        return None
    token = ProviderToken(key, config.apns_key_id, config.apns_team_id)
    try:
        token.current()
    except (ValueError, TypeError, jwt.PyJWTError) as error:
        logger.error("The APNs key can't sign a provider token (%s): push is off", type(error).__name__)
        return None
    logger.info("Push provider: APNs, topic %s", config.apns_topic)
    return ApnsPushProvider(token, config.apns_topic)
