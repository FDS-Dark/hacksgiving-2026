"""Privacy-minimized ingestion and coordination rules for voice calls."""

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID

from databridge.executor import Transactions
from databridge.voice import VoiceDatabridge
from errors import ApiError, not_found
from models.voice import (
    ImpactSummary,
    HandoffCode,
    OutcomeStatus,
    VoiceReferral,
    ReferralOutcome,
    VoiceReferralStatus,
    VoiceResource,
    VoiceDashboard,
    VoiceFollowUp,
    WebhookAccepted,
)

MAX_WEBHOOK_BYTES = 1_000_000
SIGNATURE_TOLERANCE_SECONDS = 30 * 60
HANDOFF_TTL = timedelta(minutes=15)
HANDOFF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def verify_elevenlabs_signature(
    raw_body: bytes,
    signature_header: str | None,
    secret: str,
    now: Callable[[], float] | None = None,
) -> None:
    if not signature_header or not secret:
        raise ApiError(401, "invalid_webhook_signature", "Invalid webhook signature")
    try:
        fields = dict(part.split("=", 1) for part in signature_header.split(","))
        timestamp = fields["t"]
        supplied = fields["v0"]
        timestamp_number = int(timestamp)
    except (KeyError, ValueError):
        raise ApiError(401, "invalid_webhook_signature", "Invalid webhook signature")
    if abs((now or time.time)() - timestamp_number) > SIGNATURE_TOLERANCE_SECONDS:
        raise ApiError(401, "stale_webhook_signature", "Webhook signature is stale")
    expected = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("ascii") + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        raise ApiError(401, "invalid_webhook_signature", "Invalid webhook signature")


def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _collected(data: dict[str, Any], name: str) -> Any:
    collected = _object(_object(data.get("analysis")).get("data_collection_results"))
    value = collected.get(name)
    if isinstance(value, dict):
        return value.get("value")
    if value is not None:
        return value
    initiation = _object(data.get("conversation_initiation_client_data"))
    return _object(initiation.get("dynamic_variables")).get(name)


def _short_string(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _unix_datetime(value: Any) -> datetime | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return isinstance(value, str) and value.strip().lower() in {"yes", "true", "1"}


class VoiceService:
    def __init__(self, voice: VoiceDatabridge, transactions: Transactions) -> None:
        self.voice = voice
        self.transactions = transactions

    async def resources(
        self, category: str | None, language: str | None
    ) -> list[VoiceResource]:
        return await self.voice.resources(
            _short_string(category, 64), _short_string(language, 12)
        )

    async def receive_elevenlabs_webhook(
        self, raw_body: bytes, signature_header: str | None, webhook_secret: str
    ) -> WebhookAccepted:
        if len(raw_body) > MAX_WEBHOOK_BYTES:
            raise ApiError(413, "webhook_too_large", "Webhook body is too large")
        verify_elevenlabs_signature(raw_body, signature_header, webhook_secret)
        try:
            event = json.loads(raw_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError(400, "invalid_webhook", "Invalid webhook body")
        if not isinstance(event, dict):
            raise ApiError(400, "invalid_webhook", "Invalid webhook body")

        event_type = _short_string(event.get("type"), 64)
        if event_type != "post_call_transcription":
            return WebhookAccepted()
        data = _object(event.get("data"))
        conversation_id = _short_string(data.get("conversation_id"), 64)
        event_timestamp = event.get("event_timestamp")
        occurred_at = _unix_datetime(event_timestamp)
        if (
            not conversation_id
            or not isinstance(event_timestamp, int)
            or isinstance(event_timestamp, bool)
        ):
            raise ApiError(
                400, "invalid_webhook", "Webhook is missing its conversation identity"
            )
        if occurred_at is None:
            raise ApiError(
                400, "invalid_webhook", "Webhook has an invalid event timestamp"
            )

        urgency = _short_string(_collected(data, "urgency_tier"), 16)
        if urgency not in {"emergency", "urgent", "routine"}:
            urgency = None
        disposition = _short_string(_collected(data, "disposition"), 64)
        if urgency == "emergency":
            disposition = "redirect_911"
        metadata = _object(data.get("metadata"))
        started_at = _unix_datetime(metadata.get("start_time_unix_secs"))
        duration = metadata.get("call_duration_secs")
        ended_at = None
        if (
            started_at is not None
            and isinstance(duration, (int, float))
            and not isinstance(duration, bool)
        ):
            ended_at = datetime.fromtimestamp(
                started_at.timestamp() + max(0, duration), tz=timezone.utc
            )

        async with self.transactions.transaction() as transaction:
            voice = self.voice.within(transaction)
            call = await voice.ingest_call(
                conversation_id=conversation_id,
                event_timestamp=event_timestamp,
                language=_short_string(_collected(data, "language"), 12),
                need_category=_short_string(_collected(data, "need_category"), 64),
                urgency_tier=urgency,
                neighborhood=_short_string(_collected(data, "neighborhood"), 80),
                callback_consent=_boolean(_collected(data, "callback_consent")),
                disposition=disposition,
                started_at=started_at,
                ended_at=ended_at,
            )
            stored = await voice.append_event(
                call_id=call.id,
                event_key=f"{event_type}:{conversation_id}:{event_timestamp}",
                event_type=event_type,
                details={"provider_status": _short_string(data.get("status"), 32)},
                occurred_at=occurred_at,
            )
        return WebhookAccepted(duplicate=stored is None)

    async def create_referral(
        self, conversation_id: str, resource_slug: str, status: VoiceReferralStatus
    ) -> VoiceReferral:
        call = await self.voice.call_by_conversation(conversation_id)
        if not call:
            call = await self.voice.begin_call(conversation_id)
        referral = await self.voice.create_referral(call.id, resource_slug, status)
        if not referral:
            raise ApiError(
                400,
                "resource_not_referrable",
                "Resource is unavailable or cannot be used as a referral destination",
            )
        return referral

    @staticmethod
    def _handoff_hash(code: str, secret: str) -> str:
        if not secret:
            raise ApiError(
                503,
                "voice_handoff_unavailable",
                "Call handoff is not configured",
            )
        return hmac.new(
            secret.encode(), code.encode("ascii"), hashlib.sha256
        ).hexdigest()

    async def create_handoff(self, conversation_id: str, secret: str) -> HandoffCode:
        call = await self.voice.call_by_conversation(conversation_id)
        if not call:
            call = await self.voice.begin_call(conversation_id)
        code = "".join(secrets.choice(HANDOFF_ALPHABET) for _ in range(8))
        expires_at = datetime.now(timezone.utc) + HANDOFF_TTL
        stored_expiry = await self.voice.create_handoff(
            call.id, self._handoff_hash(code, secret), expires_at
        )
        return HandoffCode(code=code, expires_at=stored_expiry)

    async def claim_handoff(
        self, user_id: UUID, code: str, secret: str
    ) -> VoiceFollowUp:
        normalized = code.strip().upper()
        follow_up = await self.voice.claim_handoff(
            self._handoff_hash(normalized, secret), user_id
        )
        if not follow_up:
            raise ApiError(
                404,
                "handoff_not_found",
                "That call code is invalid, expired, or already claimed",
            )
        return follow_up

    async def follow_ups(self, user_id: UUID) -> list[VoiceFollowUp]:
        return await self.voice.follow_ups(user_id)

    async def record_outcome(
        self, referral_id: UUID, status: OutcomeStatus, reason_code: str | None
    ) -> ReferralOutcome:
        outcome = await self.voice.record_outcome(referral_id, status, reason_code)
        if not outcome:
            raise not_found("referral")
        return outcome

    async def impact(self) -> ImpactSummary:
        return await self.voice.impact()

    async def dashboard(self) -> VoiceDashboard:
        return await self.voice.dashboard()
