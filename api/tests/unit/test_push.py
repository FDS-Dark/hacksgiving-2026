"""Push: the APNs provider token, headers and payload (fixed strings only),
the push job's decisions (quiet hours across time zones, coalescing, the
hourly cap, urgent bypass), what each APNs answer does to a delivery and a
device, and the settings. Against in-memory stored functions
(tests/unit/fakes.py) and httpx's MockTransport."""

import json
from collections.abc import Mapping
from datetime import datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from adapters.push import (
    ApnsPushProvider,
    FakePushProvider,
    ProviderToken,
    PushMessage,
    PushResult,
    apns_headers,
    apns_payload,
    make_push_provider,
)
from databridge.job import JobDatabridge
from databridge.push import PushDatabridge
from models.job import Job
from models.push import ClaimedDelivery, PushFacts
from services.push_jobs import (
    NOTIFICATION_PUSH,
    PushRetry,
    PushStage,
    decide,
    message_for,
    outcome,
    quiet_until,
)
from settings import PushConfig
from tests.unit.fakes import FakeFunctions, queued_job

CHICAGO = ZoneInfo("America/Chicago")
NOW = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)  # 12:00 in Chicago


def p8_key() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


KEY = p8_key()


def facts(kind: str = "assignment", **overrides: Any) -> PushFacts:
    row: dict[str, Any] = {
        "id": uuid4(), "user_id": uuid4(), "kind": kind, "case_id": uuid4(), "created_at": NOW, "read_at": None,
        "expires_at": None, "push_enabled": True, "muted_kinds": [], "quiet_start": None, "quiet_end": None,
        "timezone": "UTC", "reader_is_staff": True, "unread_count": 3, "recent_push_count": 0,
        "last_case_push_at": None,
    }
    return PushFacts(**(row | overrides))


class Device:
    def __init__(self, token: str = "ab" * 32, environment: str = "production") -> None:
        self.token = token
        self.environment = environment


# --- The provider token ------------------------------------------------------------


def test_the_provider_token_is_es256_with_kid_iss_and_iat():
    token = ProviderToken(KEY, "KEY123", "TEAM456", clock=lambda: 1_800_000_000.0).current()

    header = jwt.get_unverified_header(token)
    assert (header["alg"], header["kid"]) == ("ES256", "KEY123")
    public = serialization.load_pem_private_key(KEY.encode(), None).public_key()
    claims = jwt.decode(token, public, algorithms=["ES256"], options={"verify_iat": False})  # type: ignore[arg-type]
    assert claims == {"iss": "TEAM456", "iat": 1_800_000_000}


def test_the_provider_token_is_reused_and_renewed_after_50_minutes():
    now = [1_800_000_000.0]
    tokens = ProviderToken(KEY, "K", "T", clock=lambda: now[0])
    first = tokens.current()
    now[0] += 49 * 60
    assert tokens.current() == first
    now[0] += 60
    assert tokens.current() != first


def test_a_rejected_token_is_renewed_once_even_by_many_requests():
    now = [1_800_000_000.0]
    tokens = ProviderToken(KEY, "K", "T", clock=lambda: now[0])
    old = tokens.current()
    now[0] += 21 * 60
    renewed = tokens.renew(old)
    assert renewed != old
    now[0] += 1
    assert tokens.renew(old) == renewed  # another request already renewed it


def test_a_token_younger_than_20_minutes_is_not_renewed():
    """Apple throttles renewals (TooManyProviderTokenUpdates): a young token
    rejected (a bad key, say) is kept rather than re-signed on every retry."""
    now = [1_800_000_000.0]
    tokens = ProviderToken(KEY, "K", "T", clock=lambda: now[0])
    old = tokens.current()
    now[0] += 60
    assert tokens.renew(old) == old


# --- Headers and payload: fixed strings, the id and `u`, nothing else -----------------


def test_headers_follow_d4():
    message = message_for(facts("urgent_offer", expires_at=NOW + timedelta(minutes=5)), NOW)
    headers = apns_headers(message, "com.austinkoske.hacksgiving", "JWT")

    assert headers == {
        "authorization": "bearer JWT",
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": str(int((NOW + timedelta(minutes=5)).timestamp())),
        "apns-collapse-id": str(message.notification_id),
        "apns-topic": "com.austinkoske.hacksgiving",
    }


def test_an_urgent_offer_is_time_sensitive_and_says_nothing_about_the_case():
    f = facts("urgent_offer", expires_at=NOW + timedelta(minutes=5))
    payload = apns_payload(message_for(f, NOW))

    assert payload == {
        "aps": {
            "alert": {"title": "Urgent request", "body": "You're on call. Open the app to respond."},
            "sound": "default", "interruption-level": "time-sensitive", "thread-id": "urgent",
        },
        "n": str(f.id), "u": 1,
    }


@pytest.mark.parametrize(("kind", "title"), [
    ("assignment", "New assignment"), ("reply", "New reply"), ("task_due", "Task due soon"),
    ("referral_update", "Referral update"),
])
def test_a_staff_update_has_a_badge_and_priority_5(kind: str, title: str):
    f = facts(kind, unread_count=7)
    message = message_for(f, NOW)

    assert (message.priority, message.expiration) == (5, int((NOW + timedelta(hours=24)).timestamp()))
    assert apns_payload(message) == {
        "aps": {
            "alert": {"title": title, "body": "Open the app to see it."},
            "sound": "default", "badge": 7, "interruption-level": "active", "thread-id": "updates",
        },
        "n": str(f.id), "u": 0,
    }


def test_a_resident_gets_no_title_no_sound_and_no_badge():
    f = facts("request_update", reader_is_staff=False)
    assert apns_payload(message_for(f, NOW)) == {
        "aps": {"alert": {"body": "You have a new update."}, "interruption-level": "active", "thread-id": "updates"},
        "n": str(f.id), "u": 0,
    }


def test_unanswered_and_test_pushes():
    unanswered = message_for(facts("urgent_unanswered"), NOW)
    assert (unanswered.title, unanswered.body, unanswered.priority, unanswered.urgent) == (
        "Urgent request waiting", "Nobody has accepted yet.", 10, True)
    assert unanswered.interruption_level == "time-sensitive" and unanswered.sound
    test = message_for(facts("test"), NOW)
    assert (test.title, test.body, test.priority, test.sound, test.urgent) == (
        "Test notification", "Push works on this phone.", 10, True, False)


def test_no_payload_carries_anything_but_fixed_strings_the_id_and_u():
    allowed = {
        "Urgent request", "You're on call. Open the app to respond.", "Urgent request waiting",
        "Nobody has accepted yet.", "New assignment", "New reply", "Task due soon", "Referral update",
        "Open the app to see it.", "You have a new update.", "Test notification", "Push works on this phone.",
        "default", "active", "time-sensitive", "urgent", "updates",
    }
    for kind in ("urgent_offer", "urgent_unanswered", "assignment", "reply", "task_due", "referral_update",
                 "request_update", "test"):
        f = facts(kind)
        payload = apns_payload(message_for(f, NOW))
        assert set(payload) == {"aps", "n", "u"} and payload["n"] == str(f.id)
        strings = {v for v in payload["aps"].get("alert", {}).values()}
        strings |= {v for k, v in payload["aps"].items() if isinstance(v, str)}
        assert strings <= allowed, kind


# --- The APNs provider ------------------------------------------------------------------


def provider(handler: Any, clock: Any = None) -> ApnsPushProvider:
    tokens = ProviderToken(KEY, "K", "T", clock=clock or (lambda: 1_800_000_000.0))
    return ApnsPushProvider(tokens, "com.example.app", httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_apns_posts_to_the_devices_host_with_the_headers_and_payload():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, headers={"apns-id": "ABC-1"})

    message = message_for(facts("assignment"), NOW)
    apns = provider(handler)
    assert await apns.send(Device("cd" * 32, "sandbox"), message) == PushResult(200, None, "ABC-1")
    assert await apns.send(Device("ef" * 32, "production"), message) == PushResult(200, None, "ABC-1")

    assert [str(r.url) for r in seen] == [
        f"https://api.sandbox.push.apple.com/3/device/{'cd' * 32}",
        f"https://api.push.apple.com/3/device/{'ef' * 32}",
    ]
    assert seen[0].headers["apns-topic"] == "com.example.app"
    assert seen[0].headers["authorization"].startswith("bearer ey")
    assert json.loads(seen[0].content) == apns_payload(message)


async def test_an_expired_provider_token_is_renewed_and_the_send_retried_once():
    now = [1_800_000_000.0]
    bearers: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bearers.append(request.headers["authorization"])
        now[0] += 21 * 60  # old enough to renew; the new token has a new iat
        if len(bearers) == 1:
            return httpx.Response(403, json={"reason": "ExpiredProviderToken"})
        return httpx.Response(200, headers={"apns-id": "X"})

    result = await provider(handler, clock=lambda: now[0]).send(Device(), message_for(facts(), NOW))
    assert result.status_code == 200 and len(bearers) == 2 and bearers[0] != bearers[1]


async def test_a_token_still_rejected_after_renewing_comes_back_as_403():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"reason": "InvalidProviderToken"})

    result = await provider(handler).send(Device(), message_for(facts(), NOW))
    assert (result.status_code, result.reason) == (403, "InvalidProviderToken")
    assert outcome(result) == "retry"


async def test_no_answer_is_status_0_with_the_errors_type():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    result = await provider(handler).send(Device(), message_for(facts(), NOW))
    assert result == PushResult(0, "ConnectTimeout")


# --- Whether to send ----------------------------------------------------------------------


def test_read_muted_and_push_off_are_skipped():
    assert decide(facts(read_at=NOW), NOW, CHICAGO).reason == "read"
    assert decide(facts(push_enabled=False), NOW, CHICAGO).reason == "push_off"
    assert decide(facts("reply", muted_kinds=["reply"]), NOW, CHICAGO).reason == "muted"
    assert decide(facts(), NOW, CHICAGO).action == "send"


def test_urgent_pages_ignore_push_off_and_mutes():
    """Being on call is the opt-in: muting or turning push off can't
    silence a page (the ladder would wait out the whole step)."""
    for kind in ("urgent_offer", "urgent_unanswered"):
        assert decide(facts(kind, muted_kinds=[kind]), NOW, CHICAGO).action == "send"
        assert decide(facts(kind, push_enabled=False), NOW, CHICAGO).action == "send"


def test_quiet_hours_use_the_persons_zone_and_cross_midnight():
    # 21:00-07:00. 18:00 UTC is 12:00 in Chicago (not quiet) and 03:00 in Tokyo (quiet until 07:00 there).
    start, end = time(21, 0), time(7, 0)
    assert quiet_until(NOW, start, end, CHICAGO) is None
    tokyo = ZoneInfo("Asia/Tokyo")
    assert quiet_until(NOW, start, end, tokyo) == datetime(2026, 11, 22, 7, 0, tzinfo=tokyo)
    # 22:00 in Chicago: quiet until 07:00 the next morning.
    late = datetime(2026, 11, 22, 4, 0, tzinfo=timezone.utc)
    assert quiet_until(late, start, end, CHICAGO) == datetime(2026, 11, 22, 7, 0, tzinfo=CHICAGO)
    # A daytime window (12:00-13:00) doesn't cross midnight.
    assert quiet_until(NOW, time(12, 0), time(13, 0), CHICAGO) == datetime(2026, 11, 21, 13, 0, tzinfo=CHICAGO)
    assert quiet_until(NOW, time(12, 0), None, CHICAGO) is None


def test_quiet_hours_fall_back_to_the_orgs_zone_while_the_person_is_on_utc():
    f = facts(quiet_start=time(11, 0), quiet_end=time(13, 0), timezone="UTC")  # 12:00 in Chicago
    decision = decide(f, NOW, CHICAGO)
    assert decision.action == "defer" and decision.until == datetime(2026, 11, 21, 13, 0, tzinfo=CHICAGO)
    # Their own zone, when set: 12:00 in Chicago is 18:00 in London, outside 11-13.
    assert decide(f.model_copy(update={"timezone": "Europe/London"}), NOW, CHICAGO).action == "send"


def test_the_deferred_job_does_not_defer_again():
    f = facts(quiet_start=time(11, 0), quiet_end=time(13, 0))
    assert decide(f, NOW, CHICAGO, after_quiet=True).action == "send"


def test_a_second_push_about_the_same_case_within_2_minutes_is_coalesced():
    assert decide(facts(last_case_push_at=NOW - timedelta(seconds=90)), NOW, CHICAGO).reason == "coalesced"
    assert decide(facts(last_case_push_at=NOW - timedelta(minutes=3)), NOW, CHICAGO).action == "send"


def test_twenty_pushes_an_hour_is_the_cap():
    assert decide(facts(recent_push_count=19), NOW, CHICAGO).action == "send"
    assert decide(facts(recent_push_count=20), NOW, CHICAGO).reason == "hourly_cap"


def test_urgent_pushes_skip_quiet_hours_coalescing_and_the_cap():
    busy = {"quiet_start": time(11, 0), "quiet_end": time(13, 0), "recent_push_count": 50,
            "last_case_push_at": NOW - timedelta(seconds=10)}
    for kind in ("urgent_offer", "urgent_unanswered"):
        assert decide(facts(kind, **busy), NOW, CHICAGO).action == "send"
    assert decide(facts("test", **busy, push_enabled=False), NOW, CHICAGO).action == "send"
    assert decide(facts("assignment", **busy), NOW, CHICAGO).action == "defer"
    # An offer that has already moved on isn't pushed.
    assert decide(facts("urgent_offer", expires_at=NOW), NOW, CHICAGO).reason == "expired"


# --- What each answer does ----------------------------------------------------------------


@pytest.mark.parametrize(("status", "reason", "expected"), [
    (200, None, "sent"),
    (410, "Unregistered", "disable"),
    (410, "ExpiredToken", "disable"),
    (400, "BadDeviceToken", "disable"),
    (400, "DeviceTokenNotForTopic", "disable"),
    (400, "BadCollapseId", "failed"),
    (413, "PayloadTooLarge", "failed"),
    (403, "BadEnvironmentKeyIdInToken", "retry"),
    (429, "TooManyRequests", "retry"),
    (429, "TooManyProviderTokenUpdates", "retry"),
    (500, "InternalServerError", "retry"),
    (503, "ServiceUnavailable", "retry"),
    (0, "ConnectError", "retry"),
])
def test_each_apns_answer(status: int, reason: str | None, expected: str):
    assert outcome(PushResult(status, reason)) == expected


# --- The stage ----------------------------------------------------------------------------


def claimed(device_id: UUID | None = None, *, was_sending: bool = False) -> dict[str, Any]:
    return {"delivery_id": uuid4(), "device_id": device_id or uuid4(), "token": "ab" * 32, "platform": "ios",
            "environment": "production", "attempts": 1, "was_sending": was_sending}


def recorded(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [{"id": params["delivery_id"]}]


def push_job(notification_id: UUID, **payload: Any) -> Job:
    return Job(
        id=uuid4(), kind=NOTIFICATION_PUSH, payload={"notification_id": str(notification_id)} | payload,
        status="running", attempts=1, max_attempts=5, run_at=NOW, locked_by="w", locked_until=NOW,
        last_error=None, dedupe_key=f"notification:{notification_id}", created_at=NOW, updated_at=NOW,
        finished_at=None,
    )


def stage(db: FakeFunctions, provider: FakePushProvider | None) -> PushStage:
    return PushStage(PushDatabridge(db), JobDatabridge(db), provider, CHICAGO, clock=lambda: NOW)


async def test_the_stage_sends_once_per_claimed_device_and_records_each_answer():
    f = facts()
    rows = [claimed(), claimed()]
    db = FakeFunctions(notification_push_facts=[f.model_dump()], notification_delivery_claim=rows,
                       notification_delivery_record=recorded, push_device_disable=[{"id": uuid4()}])
    fake = FakePushProvider(results=[PushResult(200, None, "A1"), PushResult(410, "Unregistered")])

    finish = await stage(db, fake).run(push_job(f.id))
    await finish(db)

    assert len(fake.sent) == 2
    assert all(isinstance(d, ClaimedDelivery) and m.notification_id == f.id for d, m in fake.sent)
    statuses = sorted(r["status"] for r in db.called("notification_delivery_record"))
    assert statuses == ["failed", "sent"]
    (disabled,) = db.called("push_device_disable")
    assert disabled["reason"] == "Unregistered"


async def test_a_retryable_answer_puts_the_row_back_and_fails_the_job():
    f = facts()
    db = FakeFunctions(notification_push_facts=[f.model_dump()], notification_delivery_claim=[claimed(), claimed()],
                       notification_delivery_record=recorded)
    fake = FakePushProvider(results=[PushResult(200, None, "A1"), PushResult(503, "ServiceUnavailable")])

    with pytest.raises(PushRetry):
        await stage(db, fake).run(push_job(f.id))
    assert sorted(r["status"] for r in db.called("notification_delivery_record")) == ["pending", "sent"]


async def test_a_provider_that_raises_loses_no_other_answer():
    f = facts()
    db = FakeFunctions(notification_push_facts=[f.model_dump()], notification_delivery_claim=[claimed(), claimed()],
                       notification_delivery_record=recorded)

    def boom(device: Any, message: PushMessage) -> PushResult:
        raise RuntimeError("bug")

    fake = FakePushProvider(results=[boom, PushResult(200, None, "A1")])
    with pytest.raises(PushRetry):
        await stage(db, fake).run(push_job(f.id))
    assert sorted(r["status"] for r in db.called("notification_delivery_record")) == ["pending", "sent"]


async def test_a_skip_claims_nothing_and_sends_nothing():
    f = facts(read_at=NOW)
    db = FakeFunctions(notification_push_facts=[f.model_dump()], notification_delivery_claim=[])
    fake = FakePushProvider()

    await stage(db, fake).run(push_job(f.id))

    assert fake.sent == []
    assert db.called("notification_delivery_claim") == [{"notification_id": f.id, "skip_reason": "read"}]


async def test_quiet_hours_queue_the_after_quiet_job_in_finish():
    f = facts(quiet_start=time(11, 0), quiet_end=time(13, 0))
    db = FakeFunctions(notification_push_facts=[f.model_dump()], job_enqueue=queued_job)
    fake = FakePushProvider()

    finish = await stage(db, fake).run(push_job(f.id))
    assert db.called("job_enqueue") == [] and fake.sent == []
    await finish(db)

    (job,) = db.called("job_enqueue")
    assert job["dedupe_key"] == f"notification:{f.id}:after-quiet"
    assert json.loads(job["payload"]) == {"notification_id": str(f.id), "after_quiet": True}


async def test_without_a_provider_the_job_finishes_and_marks_deliveries_skipped():
    nid = uuid4()
    db = FakeFunctions(notification_delivery_claim=[])

    finish = await stage(db, None).run(push_job(nid))
    await finish(db)

    assert db.called("notification_delivery_claim") == [{"notification_id": nid, "skip_reason": "provider_off"}]


async def test_a_dead_job_fails_what_is_left():
    nid = uuid4()
    db = FakeFunctions(notification_delivery_give_up=[{"updated": 1}])
    await stage(db, FakePushProvider()).on_dead(push_job(nid))
    assert db.called("notification_delivery_give_up") == [{"notification_id": nid}]


# --- Settings -------------------------------------------------------------------------------


def test_push_is_off_by_default_and_fake_when_asked():
    assert make_push_provider(PushConfig()) is None
    assert isinstance(make_push_provider(PushConfig(provider="fake")), FakePushProvider)


def test_apns_without_a_key_is_off(caplog: pytest.LogCaptureFixture):
    assert make_push_provider(PushConfig(provider="apns", apns_key_id="K", apns_team_id="T")) is None
    assert "push is off" in caplog.text
    assert make_push_provider(PushConfig(provider="apns", apns_key="not a key", apns_key_id="K",
                                         apns_team_id="T")) is None


def test_apns_with_a_key_inline_escaped_or_from_a_file(tmp_path: Any):
    escaped = KEY.strip().replace("\n", "\\n")
    config = PushConfig(provider="apns", apns_key=escaped, apns_key_id="K", apns_team_id="T")
    assert config.signing_key() == KEY.strip() + "\n"
    assert isinstance(make_push_provider(config), ApnsPushProvider)

    path = tmp_path / "AuthKey.p8"
    path.write_text(KEY)
    from_file = PushConfig(provider="apns", apns_key_path=str(path), apns_key_id="K", apns_team_id="T")
    assert from_file.signing_key() == KEY.strip() + "\n"
    assert PushConfig(apns_key_path=str(tmp_path / "missing.p8")).signing_key() is None
