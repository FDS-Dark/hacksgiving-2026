import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import pytest

from databridge.voice import VoiceDatabridge
from errors import ApiError
from models.voice import OutcomeStatus, VoiceReferralStatus
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


@pytest.mark.parametrize("header", [None, "garbage", "t=1800000000,v0=wrong"])
def test_bad_signature_is_rejected(header: str | None):
    with pytest.raises(ApiError, match="signature"):
        verify_elevenlabs_signature(
            b"{}", header, "test-secret", now=lambda: 1_800_000_000
        )


async def test_webhook_keeps_only_allowlisted_structured_fields(monkeypatch):
    timestamp = 1_800_000_000
    payload = {
        "type": "post_call_transcription",
        "event_timestamp": timestamp,
        "data": {
            "conversation_id": "conv-1",
            "status": "done",
            "transcript": [{"role": "user", "message": "my private story"}],
            "metadata": {"phone_call": {"external_number": "+14145550123"}},
            "analysis": {
                "transcript_summary": "private summary",
                "data_collection_results": {
                    "urgency_tier": {"value": "urgent"},
                    "need_category": {"value": "violence-mediation"},
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
    monkeypatch.setattr("services.voice.time.time", lambda: timestamp)
    result = await VoiceService(VoiceDatabridge(db), db).receive_elevenlabs_webhook(
        body, _signature(body, "secret", timestamp), "secret"
    )
    assert not result.duplicate
    persisted = repr(db.calls)
    assert "private story" not in persisted
    assert "private summary" not in persisted
    assert "+14145550123" not in persisted


async def test_live_referral_begins_call_before_post_call_webhook():
    call = _call_row("conv-live")
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
        voice_referral_create=[referral],
    )
    result = await VoiceService(VoiceDatabridge(db), db).create_referral(
        "conv-live", "comforce", VoiceReferralStatus.offered
    )
    assert result.id == referral["id"]
    assert db.called("voice_referral_create")[0]["call_id"] == call["id"]


async def test_unknown_referral_outcome_is_a_clean_not_found():
    db = FakeFunctions(voice_referral_outcome_record=[])
    with pytest.raises(ApiError) as error:
        await VoiceService(VoiceDatabridge(db), db).record_outcome(
            uuid4(), OutcomeStatus.connected, None
        )
    assert error.value.status_code == 404


async def test_handoff_code_links_a_call_without_a_phone_number(monkeypatch):
    call = _call_row("conv-handoff")
    follow_up = {
        "id": uuid4(),
        "call_id": call["id"],
        "need_category": "violence-mediation",
        "urgency_tier": "urgent",
        "disposition": "comforce_handoff",
        "resources": ["ComForce MKE"],
        "linked_at": NOW,
    }
    db = FakeFunctions(
        voice_call_get_by_conversation=[call],
        voice_handoff_create=[{"expires_at": NOW}],
        voice_handoff_claim=[follow_up],
    )
    monkeypatch.setattr("services.voice.secrets.choice", lambda _: "A")
    service = VoiceService(VoiceDatabridge(db), db)

    handoff = await service.create_handoff("conv-handoff", "tool-secret")
    claimed = await service.claim_handoff(uuid4(), handoff.code, "tool-secret")

    assert handoff.code == "AAAAAAAA"
    assert claimed.call_id == call["id"]
    persisted = repr(db.calls)
    assert "phone" not in persisted
    assert "AAAAAAAA" not in persisted


async def test_handoff_rejects_an_expired_or_reused_code():
    db = FakeFunctions(voice_handoff_claim=[])
    with pytest.raises(ApiError) as error:
        await VoiceService(VoiceDatabridge(db), db).claim_handoff(
            uuid4(), "ABCDEFGH", "tool-secret"
        )
    assert error.value.status_code == 404
