"""Push against real PostgreSQL, as the app role: devices (register, move to
another user, remove, at most 10), the push job a notification queues, one
send per active device, retries that resend only what's pending, dead
tokens, no double sends, the stuck-`sending` resend, the test endpoint and
its rate limit, and admin-only stats. APNs is FakePushProvider."""

import secrets
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from adapters.push import FakePushProvider, PushResult
from databridge.job import JobDatabridge
from databridge.push import PushDatabridge
from models.job import Job
from services.push_jobs import NOTIFICATION_PUSH, PushRetry, PushStage, enqueue_push
from services.rate_limit import push_test_requests
from tests.helpers import auth_header
from tests.integration.conftest import app_executor
from worker.runner import Runner


def token() -> str:
    return secrets.token_hex(32)


async def _person(api, admin_conn, name: str, role: str = "member") -> dict:
    headers = auth_header(f"auth0|{uuid4().hex}", name=name)
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    if role != "member":
        await admin_conn.execute("UPDATE app.users SET role = $1 WHERE id = $2", role, user_id)
    return {"headers": headers, "id": user_id}


@pytest.fixture
async def people(api, admin_conn):
    return {
        "devon": await _person(api, admin_conn, "Devon Lee", "worker"),
        "maria": await _person(api, admin_conn, "Maria Santos", "worker"),
        "ana": await _person(api, admin_conn, "Ana Admin", "admin"),
        "keisha": await _person(api, admin_conn, "Keisha"),
    }


@pytest.fixture(autouse=True)
def reset_rate_limit():
    push_test_requests.reset()
    yield
    push_test_requests.reset()


@pytest.fixture
async def executor(database):
    executor = app_executor(database)
    yield executor
    await executor.dispose()


async def _register(api, person, device_token: str, environment: str = "production") -> None:
    response = await api.put("/v1/me/devices", headers=person["headers"], json={
        "token": device_token, "platform": "ios", "environment": environment, "app_version": "1.2.0"})
    assert response.status_code == 204, response.text


async def _device(admin_conn, device_token: str):
    return await admin_conn.fetchrow("SELECT * FROM app.push_devices WHERE token = $1", device_token)


async def _assignment(api, person, assignee) -> str:
    """A case `person` assigns to `assignee`: one notification for the
    assignee. Returns its id."""
    case = (await api.post("/v1/cases", headers=person["headers"], json={"title": "Ride to dialysis"})).json()
    response = await api.patch(f"/v1/cases/{case['id']}", headers=person["headers"],
                               json={"assigned_worker_id": assignee["id"]})
    assert response.status_code == 200
    (item,) = [i for i in (await api.get("/v1/notifications", headers=assignee["headers"])).json()
               if i["case_id"] == case["id"]]
    return str(item["id"])


def _stage(executor, fake: FakePushProvider) -> PushStage:
    return PushStage(PushDatabridge(executor), JobDatabridge(executor), fake, ZoneInfo("America/Chicago"))


def _job(notification_id: str) -> Job:
    return Job(
        id=uuid4(), kind=NOTIFICATION_PUSH, payload={"notification_id": notification_id}, status="running",
        attempts=1, max_attempts=5, run_at="2026-11-21T00:00:00Z", locked_by="test", locked_until=None,
        last_error=None, dedupe_key=f"notification:{notification_id}", created_at="2026-11-21T00:00:00Z",
        updated_at="2026-11-21T00:00:00Z", finished_at=None,
    )


async def _run_push_jobs(executor, fake: FakePushProvider) -> None:
    runner = Runner(JobDatabridge(executor), executor, [_stage(executor, fake)],
                    worker_id=f"test-{uuid4().hex[:6]}", lease_seconds=60)
    while await runner.tick():
        await runner.drain()


def _sent_for(fake: FakePushProvider, notification_id: str) -> list[str]:
    return [device.token for device, message in fake.sent if str(message.notification_id) == notification_id]


async def _deliveries(admin_conn, notification_id: str) -> dict[str, str]:
    rows = await admin_conn.fetch(
        "SELECT d.token, x.status FROM app.notification_deliveries x JOIN app.push_devices d ON d.id = x.device_id "
        "WHERE x.notification_id = $1", UUID(notification_id))
    return {r["token"]: r["status"] for r in rows}


# --- Devices --------------------------------------------------------------------------------


async def test_a_device_registers_moves_to_its_new_user_and_is_removed(api, people, admin_conn):
    devon, maria = people["devon"], people["maria"]
    phone = token()

    await _register(api, devon, phone.upper())  # stored lowercase
    device = await _device(admin_conn, phone)
    assert (str(device["user_id"]), device["environment"], device["app_version"]) == (
        devon["id"], "production", "1.2.0")

    # The phone changes hands: the same token now belongs to Maria.
    await _register(api, maria, phone, "sandbox")
    moved = await _device(admin_conn, phone)
    assert (moved["id"], str(moved["user_id"]), moved["environment"]) == (device["id"], maria["id"], "sandbox")

    # Devon can't remove it any more (204 all the same); Maria can.
    assert (await api.delete(f"/v1/me/devices/{phone}", headers=devon["headers"])).status_code == 204
    assert await _device(admin_conn, phone) is not None
    assert (await api.delete(f"/v1/me/devices/{phone}", headers=maria["headers"])).status_code == 204
    assert await _device(admin_conn, phone) is None


async def test_a_bad_token_or_platform_is_rejected(api, people):
    devon = people["devon"]
    for body in ({"token": "not-hex", "environment": "production"},
                 {"token": token(), "platform": "android", "environment": "production"},
                 {"token": token(), "environment": "staging"}):
        assert (await api.put("/v1/me/devices", headers=devon["headers"], json=body)).status_code == 422
    assert (await api.delete("/v1/me/devices/nothex", headers=devon["headers"])).status_code == 422


async def test_at_most_10_active_devices_the_oldest_is_disabled(api, people, admin_conn):
    devon = people["devon"]
    phones = [token() for _ in range(11)]
    for phone in phones:
        await _register(api, devon, phone)

    active = await admin_conn.fetch(
        "SELECT token FROM app.push_devices WHERE user_id = $1 AND disabled_at IS NULL", UUID(devon["id"]))
    assert len(active) == 10 and phones[0] not in {r["token"] for r in active}
    assert (await _device(admin_conn, phones[0]))["disabled_reason"] == "replaced"

    # The replaced phone is still in use: it launches, registers, and is
    # active again; now the least recently seen one goes.
    await _register(api, devon, phones[0])
    assert (await _device(admin_conn, phones[0]))["disabled_at"] is None
    assert (await _device(admin_conn, phones[1]))["disabled_reason"] == "replaced"


# --- Sending --------------------------------------------------------------------------------


async def test_a_notification_queues_a_push_that_reaches_each_active_device_once(api, people, admin_conn, executor):
    devon, maria = people["devon"], people["maria"]
    phone, ipad, old = token(), token(), token()
    await _register(api, devon, phone)
    await _register(api, devon, ipad, "sandbox")
    await _register(api, devon, old)
    await admin_conn.execute("UPDATE app.push_devices SET disabled_at = now() WHERE token = $1", old)

    notification_id = await _assignment(api, maria, devon)
    job = await admin_conn.fetchrow("SELECT kind, status FROM app.jobs WHERE dedupe_key = $1",
                                    f"notification:{notification_id}")
    assert (job["kind"], job["status"]) == (NOTIFICATION_PUSH, "queued")

    fake = FakePushProvider()
    await _run_push_jobs(executor, fake)

    assert sorted(_sent_for(fake, notification_id)) == sorted([phone, ipad])
    (message,) = {m for _, m in fake.sent if str(m.notification_id) == notification_id}
    assert (message.title, message.body, message.badge) == ("New assignment", "Open the app to see it.", 1)
    assert await _deliveries(admin_conn, notification_id) == {phone: "sent", ipad: "sent"}
    apns_ids = await admin_conn.fetch(
        "SELECT apns_id FROM app.notification_deliveries WHERE notification_id = $1", UUID(notification_id))
    assert all(r["apns_id"] for r in apns_ids)

    # The same notification's job again (a duplicate, or a late retry): nothing is sent twice.
    await enqueue_push(JobDatabridge(executor), UUID(notification_id))
    again = FakePushProvider()
    await _run_push_jobs(executor, again)
    assert _sent_for(again, notification_id) == []


async def test_a_retry_after_503_resends_only_the_pending_row(api, people, admin_conn, executor):
    devon, maria = people["devon"], people["maria"]
    phone, ipad = token(), token()
    await _register(api, devon, phone)
    await _register(api, devon, ipad)
    notification_id = await _assignment(api, maria, devon)

    first = FakePushProvider(results=[PushResult(200, None, "A1"), PushResult(503, "ServiceUnavailable")])
    with pytest.raises(PushRetry):
        await _stage(executor, first).run(_job(notification_id))
    ok, unavailable = first.sent[0][0].token, first.sent[1][0].token
    assert await _deliveries(admin_conn, notification_id) == {ok: "sent", unavailable: "pending"}

    second = FakePushProvider()
    await _stage(executor, second).run(_job(notification_id))
    assert _sent_for(second, notification_id) == [unavailable]
    assert await _deliveries(admin_conn, notification_id) == {ok: "sent", unavailable: "sent"}


async def test_410_disables_the_device_until_the_app_registers_it_again(api, people, admin_conn, executor):
    devon, maria = people["devon"], people["maria"]
    phone = token()
    await _register(api, devon, phone)
    notification_id = await _assignment(api, maria, devon)

    await _stage(executor, FakePushProvider(results=[PushResult(410, "Unregistered")])).run(_job(notification_id))

    device = await _device(admin_conn, phone)
    assert device["disabled_at"] is not None and device["disabled_reason"] == "Unregistered"
    assert await _deliveries(admin_conn, notification_id) == {phone: "failed"}

    # Apple's rule: stop until the app registers the token again. iOS often
    # hands back the same token after a reinstall, so that re-enables it.
    await _register(api, devon, phone)
    device = await _device(admin_conn, phone)
    assert (device["disabled_at"], device["disabled_reason"]) == (None, None)


async def test_a_delivery_stuck_in_sending_is_resent_once_with_the_same_collapse_id(
    api, people, admin_conn, executor
):
    devon, maria = people["devon"], people["maria"]
    phone = token()
    await _register(api, devon, phone)
    notification_id = await _assignment(api, maria, devon)
    # A worker claimed it and died before recording APNs' answer.
    (claimed,) = await PushDatabridge(executor).claim(UUID(notification_id))
    assert await _deliveries(admin_conn, notification_id) == {phone: "sending"}

    fake = FakePushProvider()
    await _stage(executor, fake).run(_job(notification_id))

    ((device, message),) = fake.sent
    assert device.was_sending and message.collapse_id == notification_id  # type: ignore[attr-defined]
    assert await _deliveries(admin_conn, notification_id) == {phone: "sent"}


async def test_a_phone_that_moved_to_someone_else_never_gets_the_old_accounts_push(
    api, people, admin_conn, executor
):
    devon, maria = people["devon"], people["maria"]
    phone = token()
    await _register(api, devon, phone)
    notification_id = await _assignment(api, maria, devon)
    await _register(api, maria, phone)

    fake = FakePushProvider()
    await _stage(executor, fake).run(_job(notification_id))
    assert fake.sent == []


async def test_a_read_notification_is_not_pushed(api, people, admin_conn, executor):
    devon, maria = people["devon"], people["maria"]
    phone = token()
    await _register(api, devon, phone)
    notification_id = await _assignment(api, maria, devon)
    await api.post(f"/v1/notifications/{notification_id}/read", headers=devon["headers"])

    fake = FakePushProvider()
    await _stage(executor, fake).run(_job(notification_id))
    assert fake.sent == []
    assert await _deliveries(admin_conn, notification_id) == {phone: "skipped"}


# --- The test push and stats ---------------------------------------------------------------


async def test_the_test_endpoint_makes_a_test_notification_3_per_10_minutes(api, people, admin_conn, executor):
    keisha = people["keisha"]  # residents can test their phone too
    phone = token()
    await _register(api, keisha, phone)

    for _ in range(3):
        assert (await api.post("/v1/notifications/test", headers=keisha["headers"])).status_code == 202
    limited = await api.post("/v1/notifications/test", headers=keisha["headers"])
    assert (limited.status_code, limited.json()["code"]) == (429, "rate_limited")

    items = (await api.get("/v1/notifications", headers=keisha["headers"])).json()
    assert [(i["kind"], i["title"], i["body"], i["route"]) for i in items] == [
        ("test", "Test notification", "Push works on this phone.", None)] * 3

    fake = FakePushProvider()
    await _run_push_jobs(executor, fake)
    tests = [m for d, m in fake.sent if d.token == phone]
    assert len(tests) == 3 and all(m.title == "Test notification" and m.priority == 10 for m in tests)


async def test_stats_are_for_admins_only(api, people):
    assert (await api.get("/v1/notifications/stats", headers=people["devon"]["headers"])).status_code == 403
    response = await api.get("/v1/notifications/stats", headers=people["ana"]["headers"])
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"since", "deliveries", "active_devices", "disabled_devices", "top_reasons"}
    assert all(isinstance(v, int) for v in body["deliveries"].values())
