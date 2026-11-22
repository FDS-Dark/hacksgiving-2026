"""Push for a request sent without an account, against real PostgreSQL as
the app role: a phone subscribes with the number and access code, a staff
reply or status change pushes it ("You have a new update", silent, with
the request's id), at most 3 phones per request, dead tokens are dropped."""

import json
import secrets
from uuid import uuid4

import pytest

from adapters.push import FakePushProvider, PushResult, apns_payload
from databridge.request_push import RequestPushDatabridge
from models.job import Job
from services.request_push import REQUEST_PUSH, RequestPushStage
from tests.helpers import auth_header
from tests.integration.conftest import app_executor


def _token() -> str:
    return secrets.token_hex(32)


async def _anonymous_request(api) -> dict:
    sent = await api.post("/v1/public/requests", json={
        "description": "We need somewhere to sleep tonight.", "category": "homelessness", "contact_method": "none",
    })
    assert sent.status_code == 201
    body = sent.json()
    return {"id": body["request"]["id"], "number": body["request"]["number"], "code": body["access_code"]}


async def _subscribe(api, request: dict, token: str, code: str | None = None):
    return await api.post(
        f"/v1/public/requests/{request['number']}/devices",
        headers={"X-Access-Code": code or request["code"]},
        json={"token": token, "environment": "production"},
    )


async def _worker(api, admin_conn) -> dict:
    headers = auth_header(f"auth0|{uuid4().hex}", name="Maria Santos")
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", user_id)
    return headers


async def _jobs_for(admin_conn, case_id: str) -> list[Job]:
    rows = await admin_conn.fetch(
        "SELECT * FROM app.jobs WHERE kind = $1 AND payload->>'case_id' = $2 ORDER BY created_at",
        REQUEST_PUSH, case_id,
    )
    return [Job(**(dict(r) | {"payload": json.loads(r["payload"])})) for r in rows]


@pytest.fixture
async def subscriptions(database):
    executor = app_executor(database)
    yield RequestPushDatabridge(executor)
    await executor.dispose()


async def test_only_the_right_code_subscribes(api):
    request = await _anonymous_request(api)
    assert (await _subscribe(api, request, _token(), code="WRONG-CODE")).status_code == 404
    assert (await _subscribe(api, request, _token())).status_code == 204


async def test_a_staff_reply_pushes_subscribed_phones_with_nothing_but_the_request_id(api, admin_conn, subscriptions):
    request = await _anonymous_request(api)
    tokens = [_token() for _ in range(4)]
    for token in tokens:
        assert (await _subscribe(api, request, token)).status_code == 204

    staff = await _worker(api, admin_conn)
    reply = await api.post(f"/v1/cases/{request['id']}/updates", headers=staff,
                           json={"content": "A bed is held for you at the shelter until 9 PM.", "visibility": "public"})
    assert reply.status_code == 201
    note = await api.post(f"/v1/cases/{request['id']}/updates", headers=staff,
                          json={"content": "Internal: called the shelter.", "visibility": "internal"})
    assert note.status_code == 201

    jobs = await _jobs_for(admin_conn, request["id"])
    assert len(jobs) == 1  # the public reply only, not the internal note

    fake = FakePushProvider()
    await RequestPushStage(subscriptions, fake).run(jobs[0])
    # Three phones at most: the first one subscribed was replaced.
    assert sorted(d.token for d, _ in fake.sent) == sorted(tokens[1:])
    payload = apns_payload(fake.sent[0][1])
    assert payload["aps"]["alert"] == {"body": "You have a new update."}
    assert "sound" not in payload["aps"]
    assert payload["r"] == request["id"]
    assert "shelter" not in json.dumps(payload)


async def test_a_dead_token_is_dropped_and_unsubscribing_stops_pushes(api, admin_conn, subscriptions):
    request = await _anonymous_request(api)
    dead, live = _token(), _token()
    await _subscribe(api, request, dead)
    await _subscribe(api, request, live)
    staff = await _worker(api, admin_conn)
    await api.patch(f"/v1/cases/{request['id']}", headers=staff, json={"status": "in_progress"})
    [job] = await _jobs_for(admin_conn, request["id"])

    def answer(device, message):
        return PushResult(410, "Unregistered") if device.token == dead else PushResult(200, None, "id")

    fake = FakePushProvider(results=[answer, answer])
    await RequestPushStage(subscriptions, fake).run(job)
    assert [t.token for t in await subscriptions.targets(request["id"])] == [live]

    removed = await api.delete(f"/v1/public/requests/{request['number']}/devices/{live}",
                               headers={"X-Access-Code": request["code"]})
    assert removed.status_code == 204
    assert await subscriptions.targets(request["id"]) == []
