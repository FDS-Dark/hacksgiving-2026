import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any, cast
from uuid import uuid4

import pytest
from pydantic import ValidationError

from databridge.voice import VoiceDatabridge
from errors import ApiError
from models.case import (
    AnonymousRequestReceipt,
    CaseStatus,
    ContactMethod,
    PublicRequest,
)
from models.case_enums import CaseCategory
from models.routing import RouteResponse, Service
from models.voice import (
    OutcomeStatus,
    VoiceCaseRequest,
    VoiceCaseUrgency,
    VoiceReferralStatus,
    VoiceRouteRequest,
)
from routers.voice import (
    URGENT_NOTE,
    app_capabilities,
    opportunities,
    route_voice_request,
    submit_voice_request,
)
from services.case import CaseService
from services.opportunity import OpportunityService
from services.routing import RoutingService
from services.voice import VoiceService, verify_elevenlabs_signature
from settings import config
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


def _referral_detail_row(call_id=None) -> dict[str, Any]:
    return {
        "id": uuid4(),
        "call_id": call_id or uuid4(),
        "need_category": "mental-health-crisis",
        "resource_slug": "milwaukee-mobile-crisis",
        "resource_name": "Milwaukee Mobile Crisis",
        "resource_category": "mental-health-crisis",
        "resource_description": "24/7 mental-health crisis response.",
        "phone_e164": "+14142577222",
        "languages": ["en", "es"],
        "service_area": "Milwaukee",
        "hours_label": "24/7",
        "status": "accepted",
        "outcome_status": "connected",
        "outcome_reason_code": None,
        "created_at": NOW,
    }


def _call_review_row(call_id=None) -> dict[str, Any]:
    return {
        "id": call_id or uuid4(),
        "need_category": "mental-health-crisis",
        "urgency_tier": "urgent",
        "callback_consent": True,
        "disposition": "warm_transfer",
        "started_at": NOW,
        "ended_at": NOW,
        "created_at": NOW,
        "referral_count": 1,
        "referral_names": ["Milwaukee Mobile Crisis"],
        "request_number": 1042,
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
            "conversation_initiation_client_data": {
                "dynamic_variables": {"system__caller_id": "+14145550123"}
            },
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
        body, _signature(body, "secret", timestamp), "secret", "phone-secret"
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


async def test_shared_app_route_is_persisted_without_free_text():
    call = _call_row("conv-route")
    db = FakeFunctions(voice_call_ingest=[call])
    await VoiceService(VoiceDatabridge(db), db).record_route(
        "conv-route", "bridge_to_employment", False
    )
    persisted = db.called("voice_call_ingest")[0]
    assert persisted["need_category"] == "bridge_to_employment"
    assert persisted["urgency_tier"] == "routine"
    assert "message" not in persisted


async def test_case_submission_event_keeps_only_structured_case_metadata():
    call = _call_row("conv-case")
    request_id = uuid4()
    event = {
        "id": uuid4(),
        "call_id": call["id"],
        "event_key": "case_submitted:conv-case:1042",
        "event_type": "case_submitted",
        "details": {
            "request_id": str(request_id),
            "request_number": 1042,
            "category": "transportation",
            "contact_method": "text",
            "urgency": "routine",
        },
        "occurred_at": NOW,
    }
    db = FakeFunctions(
        voice_call_ingest=[call],
        voice_call_event_append=[event],
    )

    await VoiceService(VoiceDatabridge(db), db).record_case_submission(
        "conv-case",
        request_id,
        1042,
        CaseCategory.TRANSPORTATION,
        ContactMethod.TEXT,
    )

    persisted = repr(db.calls)
    assert "approved_summary" not in persisted
    assert "transcript" not in persisted
    assert db.called("voice_call_ingest")[0]["callback_consent"] is True
    details = json.loads(db.called("voice_call_event_append")[0]["details"])
    assert details == event["details"]


async def test_resident_referral_list_is_scoped_by_verified_user_id():
    user_id = uuid4()
    referral = _referral_detail_row()
    db = FakeFunctions(voice_referral_list_for_user=[referral])

    result = await VoiceService(VoiceDatabridge(db), db).referrals_for_user(user_id)

    assert [item.id for item in result] == [referral["id"]]
    assert db.called("voice_referral_list_for_user") == [{"user_id": user_id}]


async def test_resident_referral_detail_is_scoped_and_missing_is_404():
    user_id, referral_id = uuid4(), uuid4()
    referral = _referral_detail_row() | {"id": referral_id}
    rows = iter([[referral], []])
    db = FakeFunctions(voice_referral_get_for_user=lambda _: next(rows))
    service = VoiceService(VoiceDatabridge(db), db)

    found = await service.referral_for_user(user_id, referral_id)
    assert found.resource_slug == "milwaukee-mobile-crisis"
    assert db.called("voice_referral_get_for_user")[0] == {
        "user_id": user_id,
        "referral_id": referral_id,
    }
    with pytest.raises(ApiError) as error:
        await service.referral_for_user(user_id, uuid4())
    assert error.value.code == "referral_not_found"


async def test_staff_call_review_list_returns_only_structured_summary():
    review = _call_review_row()
    db = FakeFunctions(voice_call_review_list=[review])

    result = await VoiceService(VoiceDatabridge(db), db).call_reviews()

    assert [item.id for item in result] == [review["id"]]
    assert result[0].request_number == 1042
    assert "transcript" not in repr(result[0]).lower()
    assert db.called("voice_call_review_list") == [{}]


async def test_staff_call_review_detail_combines_call_and_referrals_or_404():
    call_id = uuid4()
    review = _call_review_row(call_id)
    referral = _referral_detail_row(call_id)
    reviews = iter([[review], []])
    db = FakeFunctions(
        voice_call_review_get=lambda _: next(reviews),
        voice_referral_list_for_call=[referral],
    )
    service = VoiceService(VoiceDatabridge(db), db)

    detail = await service.call_review(call_id)
    assert detail.call.id == call_id
    assert [item.id for item in detail.referrals] == [referral["id"]]
    assert db.called("voice_call_review_get")[0] == {"call_id": call_id}
    assert db.called("voice_referral_list_for_call") == [{"call_id": call_id}]
    with pytest.raises(ApiError) as error:
        await service.call_review(uuid4())
    assert error.value.code == "call_not_found"


async def test_voice_route_uses_app_classifier_and_records_category():
    routed = RouteResponse(
        service=Service.BRIDGE_TO_EMPLOYMENT,
        also_relevant=[Service.TRANSPORTATION],
        urgent=False,
        reason="They want help finding work.",
    )

    class Routing:
        async def route(self, message: str):
            assert message == "I need job training"
            return routed

    class Voice:
        recorded = None

        async def record_route(self, conversation_id: str, category: str, urgent: bool):
            self.recorded = (conversation_id, category, urgent)

    voice = Voice()
    result = await route_voice_request(
        VoiceRouteRequest(
            conversation_id="conv-employment", message="I need job training"
        ),
        cast(RoutingService, Routing()),
        cast(VoiceService, voice),
    )
    assert result.service_name == "Bridge to Employment"
    assert result.app_destination == "Get Help"
    assert voice.recorded == ("conv-employment", "bridge_to_employment", False)


async def test_app_capabilities_explain_handoff_and_job_limit():
    result = await app_capabilities()
    assert any(item.name == "Bridge to Employment" for item in result.services)
    assert any("works once" in step for step in result.handoff_steps)
    assert any("currently open opportunities" in item for item in result.limitations)


async def test_voice_opportunities_use_same_open_directory_as_app():
    class Opportunities:
        called = None

        async def search(self, query, kind, include_closed, limit=None):
            self.called = (query, kind, include_closed, limit)
            return []

    service = Opportunities()
    result = await opportunities("mentor", None, cast(OpportunityService, service))
    assert result == []
    # A phone agent reads a short list: staff postings come first.
    assert service.called == ("mentor", None, False, 25)


def test_voice_case_request_requires_explicit_and_complete_contact_consent():
    base = {
        "conversation_id": "conv-case",
        "approved_summary": "Caller approved this short summary.",
        "category": "transportation",
    }
    with pytest.raises(ValidationError):
        VoiceCaseRequest.model_validate({**base, "consent": False})
    with pytest.raises(ValidationError, match="system caller id"):
        VoiceCaseRequest.model_validate(
            {
                **base,
                "consent": True,
                "contact_method": "text",
                "safe_to_contact": True,
            }
        )


async def test_voice_request_creates_anonymous_case_from_approved_fields_only():
    request_id = uuid4()
    receipt = AnonymousRequestReceipt(
        request=PublicRequest(
            id=request_id,
            number=1042,
            title="Ride to an appointment",
            description="Caller approved this short summary.",
            category=CaseCategory.TRANSPORTATION,
            status=CaseStatus.NEW,
            location="North Side",
            created_at=NOW,
            updated_at=NOW,
        ),
        access_code="K7QM-4XPA",
    )

    class Cases:
        submitted = None

        async def submit_anonymous_request(self, body, triage, *, urgent_note=None):
            self.submitted = (body, triage)
            self.urgent_note = urgent_note
            return receipt

    class Voice:
        recorded = None

        async def record_case_submission(self, *args):
            self.recorded = args

    cases = Cases()
    voice = Voice()
    body = VoiceCaseRequest(
        conversation_id="conv-case",
        consent=True,
        approved_summary="Caller approved this short summary.",
        category=CaseCategory.TRANSPORTATION,
        general_location="North Side",
        contact_method=ContactMethod.TEXT,
        caller_id="+14145550123",
        safe_to_contact=True,
    )

    result = await submit_voice_request(
        body,
        cast(CaseService, cases),
        cast(VoiceService, voice),
    )

    assert cases.submitted is not None
    submitted, triage = cases.submitted
    assert triage is None
    assert submitted.description == "Caller approved this short summary."
    assert submitted.contact_phone == "+14145550123"
    assert result.request_number == 1042
    assert result.access_code == "K7QM-4XPA"
    assert voice.recorded == (
        "conv-case",
        request_id,
        1042,
        CaseCategory.TRANSPORTATION,
        ContactMethod.TEXT,
        VoiceCaseUrgency.ROUTINE,
    )
    assert cases.urgent_note is None
    assert result.urgent is False


def _receipt() -> AnonymousRequestReceipt:
    return AnonymousRequestReceipt(
        request=PublicRequest(
            id=uuid4(),
            number=1043,
            title="Sleeping outside tonight",
            description="Caller approved this short summary.",
            category=CaseCategory.HOMELESSNESS,
            status=CaseStatus.NEW,
            location="Near Northwest",
            created_at=NOW,
            updated_at=NOW,
        ),
        access_code="K7QM-4XPB",
    )


class _UrgentCases:
    urgent_note: str | None = None

    async def submit_anonymous_request(self, body, triage, *, urgent_note=None):
        self.urgent_note = urgent_note
        return _receipt()


class _QuietVoice:
    recorded: tuple[Any, ...] = ()

    async def record_case_submission(self, *args):
        self.recorded = args


def _urgent_body() -> VoiceCaseRequest:
    return VoiceCaseRequest(
        conversation_id="conv-urgent",
        consent=True,
        approved_summary="Caller approved this short summary.",
        category=CaseCategory.HOMELESSNESS,
        urgency=VoiceCaseUrgency.URGENT,
    )


async def test_an_urgent_voice_request_pages_on_call(monkeypatch):
    monkeypatch.setattr(config.voice, "urgent_pages_on_call", True)
    cases, voice = _UrgentCases(), _QuietVoice()

    result = await submit_voice_request(
        _urgent_body(), cast(CaseService, cases), cast(VoiceService, voice)
    )

    assert cases.urgent_note == URGENT_NOTE
    assert result.urgent is True
    assert voice.recorded[-1] == VoiceCaseUrgency.URGENT


async def test_the_switch_keeps_urgent_voice_requests_from_paging(monkeypatch):
    monkeypatch.setattr(config.voice, "urgent_pages_on_call", False)
    cases, voice = _UrgentCases(), _QuietVoice()

    result = await submit_voice_request(
        _urgent_body(), cast(CaseService, cases), cast(VoiceService, voice)
    )

    assert cases.urgent_note is None
    assert result.urgent is False
    # The call still records what Ava judged.
    assert voice.recorded[-1] == VoiceCaseUrgency.URGENT


def test_a_voice_request_cannot_be_an_emergency():
    with pytest.raises(ValidationError):
        VoiceCaseRequest.model_validate(
            {
                "conversation_id": "conv-case",
                "consent": True,
                "approved_summary": "Someone has a gun",
                "category": "incident_deescalation",
                "urgency": "emergency",
            }
        )


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

    handoff = await service.create_handoff(
        "conv-handoff", "+14145550123", "tool-secret"
    )
    claimed = await service.claim_handoff(uuid4(), handoff.code, "tool-secret")

    assert handoff.code == "AAAAAAAA"
    assert claimed.call_id == call["id"]
    persisted = repr(db.calls)
    assert "phone" not in persisted
    assert "AAAAAAAA" not in persisted
    assert "+14145550123" not in persisted


async def test_handoff_rejects_an_expired_or_reused_code():
    db = FakeFunctions(voice_handoff_claim=[])
    with pytest.raises(ApiError) as error:
        await VoiceService(VoiceDatabridge(db), db).claim_handoff(
            uuid4(), "ABCDEFGH", "tool-secret"
        )
    assert error.value.status_code == 404
