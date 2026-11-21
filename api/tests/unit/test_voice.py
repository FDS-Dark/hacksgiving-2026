import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import pytest

from databridge.voice import VoiceDatabridge
from errors import ApiError
from models.voice import OutcomeStatus, ReferralStatus
from services.voice import VoiceService, verify_elevenlabs_signature
from tests.unit.fakes import FakeFunctions

NOW = datetime.now(timezone.utc)


def _signature(body: bytes, secret: str, timestamp: int) -> str:
    digest = hmac.new(
        secret.encode(), str(timestamp).encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    return f"t={timestamp},v0={digest}"


def _call_row(conversation_id: str = "conv-1") -> dict[str, Any]:
    return {
        "id": uuid4(),
        "provider": "elevenlabs",
        "conversation_id": conversation_id,
        "language": "en",
        "need_category": "violence-mediation",
        "urgency_tier": "urgent",
        "neighborhood": "North Side",
        "callback_consent": False,
        "disposition": "comforce_handoff",
        "event_timestamp": int(NOW.timestamp()),
        "started_at": NOW,
        "ended_at": NOW,
        "created_at": NOW,
    }


def test_valid_signature_is_accepted():
    body, secret, timestamp = b'{"safe":true}', "test-secret", 1_800_000_000
    verify_elevenlabs_signature(
        body, _signature(body, secret, timestamp), secret, now=lambda: timestamp
    )


@pytest.mark.parametrize(
    "header",
    [None, "garbage", "t=1800000000,v0=wrong", "t=not-a-time,v0=wrong"],
)
def test_bad_signature_is_rejected(header: str | None):
    with pytest.raises(ApiError, match="signature"):
        verify_elevenlabs_signature(
            b"{}", header, "test-secret", now=lambda: 1_800_000_000
        )


def test_stale_signature_is_rejected():
    body, secret = b"{}", "test-secret"
    with pytest.raises(ApiError) as error:
        verify_elevenlabs_signature(
            body, _signature(body, secret, 1_700_000_000), secret, now=lambda: 1_800_000_000
        )
    assert error.value.code == "stale_webhook_signature"


async def test_webhook_keeps_only_allowlisted_structured_fields(monkeypatch):
    timestamp = 1_800_000_000
    payload = {
        "type": "post_call_transcription",
        "event_timestamp": timestamp,
        "data": {
            "conversation_id": "conv-1",
            "status": "done",
            "transcript": [{"role": "user", "message": "my private story"}],
            "metadata": {
                "start_time_unix_secs": timestamp - 60,
                "call_duration_secs": 60,
                "phone_call": {"external_number": "+14145550123"},
            },
            "analysis": {
                "transcript_summary": "private summary",
                "data_collection_results": {
                    "language": {"value": "en"},
                    "need_category": {"value": "violence-mediation"},
                    "urgency_tier": {"value": "urgent"},
                    "neighborhood": {"value": "North Side"},
                    "callback_consent": {"value": False},
                    "disposition": {"value": "comforce_handoff"},
                },
            },
        },
    }
    body = json.dumps(payload).encode()
    row = _call_row()
    event_row = {
        "id": uuid4(),
        "call_id": row["id"],
        "event_key": f"post_call_transcription:conv-1:{timestamp}",
        "event_type": "post_call_transcription",
        "details": {"provider_status": "done"},
        "occurred_at": datetime.fromtimestamp(timestamp, tz=timezone.utc),
    }
    db = FakeFunctions(voice_call_ingest=[row], voice_call_event_append=[event_row])
    service = VoiceService(VoiceDatabridge(db), db)
    monkeypatch.setattr("services.voice.time.time", lambda: timestamp)

    result = await service.receive_elevenlabs_webhook(
        body, _signature(body, "secret", timestamp), "secret"
    )

    assert not result.duplicate
    persisted = repr(db.calls)
    assert "private story" not in persisted
    assert "private summary" not in persisted
    assert "+14145550123" not in persisted
    assert db.transactions == 1


async def test_emergency_can_only_be_recorded_as_a_911_redirect(monkeypatch):
    timestamp = 1_800_000_000
    payload = {
        "type": "post_call_transcription",
        "event_timestamp": timestamp,
        "data": {
            "conversation_id": "conv-emergency",
            "analysis": {
                "data_collection_results": {
                    "urgency_tier": {"value": "emergency"},
                    "disposition": {"value": "transfer_911"},
                }
            },
        },
    }
    body = json.dumps(payload).encode()
    row = _call_row("conv-emergency") | {
        "urgency_tier": "emergency",
        "disposition": "redirect_911",
    }
    event = {
        "id": uuid4(),
        "call_id": row["id"],
        "event_key": f"post_call_transcription:conv-emergency:{timestamp}",
        "event_type": "post_call_transcription",
        "details": {"provider_status": None},
        "occurred_at": datetime.fromtimestamp(timestamp, tz=timezone.utc),
    }
    db = FakeFunctions(voice_call_ingest=[row], voice_call_event_append=[event])
    monkeypatch.setattr("services.voice.time.time", lambda: timestamp)

    await VoiceService(VoiceDatabridge(db), db).receive_elevenlabs_webhook(
        body, _signature(body, "secret", timestamp), "secret"
    )

    assert db.called("voice_call_ingest")[0]["disposition"] == "redirect_911"


async def test_webhook_retry_is_idempotent(monkeypatch):
    timestamp = 1_800_000_000
    payload = {
        "type": "post_call_transcription",
        "event_timestamp": timestamp,
        "data": {"conversation_id": "conv-1"},
    }
    body = json.dumps(payload).encode()
    db = FakeFunctions(voice_call_ingest=[_call_row()], voice_call_event_append=[])
    monkeypatch.setattr("services.voice.time.time", lambda: timestamp)

    result = await VoiceService(VoiceDatabridge(db), db).receive_elevenlabs_webhook(
        body, _signature(body, "secret", timestamp), "secret"
    )

    assert result.duplicate


async def test_live_referral_idempotently_begins_call_before_post_call_webhook():
    call = _call_row("conv-live") | {
        "language": None,
        "need_category": None,
        "urgency_tier": None,
        "neighborhood": None,
        "disposition": None,
    }
    referral = {
        "id": uuid4(),
        "call_id": call["id"],
        "resource_id": uuid4(),
        "status": "offered",
        "created_at": NOW,
    }
    db = FakeFunctions(
        voice_call_get_by_conversation=[],
        voice_call_begin=[call],
        referral_create=[referral],
    )

    result = await VoiceService(VoiceDatabridge(db), db).create_referral(
        "conv-live", "comforce", ReferralStatus.offered
    )

    assert result.id == referral["id"]
    assert db.called("voice_call_begin") == [{"conversation_id": "conv-live"}]
    assert db.called("referral_create")[0]["call_id"] == call["id"]


async def test_unknown_referral_outcome_is_a_clean_not_found():
    db = FakeFunctions(referral_outcome_record=[])

    with pytest.raises(ApiError) as error:
        await VoiceService(VoiceDatabridge(db), db).record_outcome(
            uuid4(), OutcomeStatus.connected, None
        )

    assert error.value.status_code == 404
    assert error.value.code == "referral_not_found"
