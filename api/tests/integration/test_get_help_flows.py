"""A resident asks for help, over HTTP against real PostgreSQL as the app
role: with and without an account, safe-contact preferences, replies, and
the tasks workers get and close."""

from uuid import uuid4

import pytest

from services.rate_limit import anonymous_submissions, code_lookups
from tests.helpers import auth_header


@pytest.fixture
async def worker(api, admin_conn):
    header = auth_header(f"auth0|{uuid4().hex}", name="Wes Worker")
    worker_id = (await api.get("/v1/me", headers=header)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    return {"header": header, "id": worker_id}


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    anonymous_submissions.reset()
    code_lookups.reset()
    yield
    anonymous_submissions.reset()
    code_lookups.reset()


async def test_a_request_without_an_account_from_submission_to_reply(api, worker):
    sent = await api.post("/v1/public/requests", json={
        "description": "My family was evicted today and we have nowhere to sleep tonight.",
        "category": "homelessness",
        "location": "N 35th St & W Center St",
        "contact_method": "call",
        "contact_phone": "(414) 555-0142",
        "safe_to_contact": False,
    })
    assert sent.status_code == 201
    receipt = sent.json()
    number, code = receipt["request"]["number"], receipt["access_code"]
    assert "contact_phone" not in receipt["request"]

    as_holder = {"X-Access-Code": code.lower().replace("-", "")}
    mine = (await api.get(f"/v1/public/requests/{number}", headers=as_holder)).json()
    assert [u["content"] for u in mine["updates"]] == ["Request received."]
    wrong = await api.get(f"/v1/public/requests/{number}", headers={"X-Access-Code": "AAAA-AAAA"})
    assert wrong.status_code == 404

    case_id = receipt["request"]["id"]
    case = (await api.get(f"/v1/cases/{case_id}", headers=worker["header"])).json()
    assert (case["case"]["contact_method"], case["case"]["safe_to_contact"]) == ("call", False)
    assert case["case"]["requester_id"] is None
    titles = [t["title"] for t in case["tasks"]]
    assert titles == ["Call the requester", "Find a shelter bed for tonight", "Offer a ride to the shelter"]
    assert "voicemail" in case["tasks"][0]["detail"]

    await api.post(f"/v1/cases/{case_id}/updates", headers=worker["header"],
                   json={"content": "Two beds at the family shelter. Can you get there by 8?", "visibility": "public"})
    reply = await api.post(f"/v1/public/requests/{number}/replies", headers=as_holder,
                           json={"content": "Yes, please send a ride."})
    assert reply.status_code == 201 and reply.json()["update_type"] == "reply"

    seen = (await api.get(f"/v1/public/requests/{number}", headers=as_holder)).json()["updates"]
    assert [u["update_type"] for u in seen] == ["created", "message", "reply"]
    history = (await api.get(f"/v1/cases/{case_id}", headers=worker["header"])).json()["updates"]
    assert history[-1]["update_type"] == "reply" and history[-1]["author_id"] is None


async def test_dont_contact_me_is_respected_end_to_end(api, worker):
    member = auth_header(f"auth0|{uuid4().hex}", name="Casey")
    sent = await api.post("/v1/requests", headers=member, json={
        "description": "Someone keeps following me home from the bus stop.",
        "category": "violence_prevention",
        "contact_method": "none",
        "contact_phone": "414-555-0100",
    })
    assert sent.status_code == 201

    case = (await api.get(f"/v1/cases/{sent.json()['id']}", headers=worker["header"])).json()
    assert (case["case"]["contact_method"], case["case"]["contact_phone"]) == ("none", None)
    assert case["tasks"][0]["title"] == "Review the request (no contact wanted)"

    reply = await api.post(f"/v1/requests/{sent.json()['id']}/replies", headers=member, json={"content": "Thanks"})
    stranger = auth_header(f"auth0|{uuid4().hex}")
    theirs = await api.post(f"/v1/requests/{sent.json()['id']}/replies", headers=stranger, json={"content": "Hi"})
    assert (reply.status_code, theirs.status_code) == (201, 404)


async def test_workers_see_and_close_the_tasks_on_cases_they_hold(api, worker):
    request = (await api.post("/v1/public/requests", json={
        "description": "No food at home since Friday.", "category": "meal_programs",
        "contact_method": "text", "contact_phone": "414-555-0101", "safe_to_contact": True,
    })).json()["request"]
    header = worker["header"]

    assert [t for t in (await api.get("/v1/tasks", headers=header, params={"mine": True})).json()
            if t["case_id"] == request["id"]] == []
    await api.patch(f"/v1/cases/{request['id']}", headers=header, json={"assigned_worker_id": worker["id"]})
    mine = [t for t in (await api.get("/v1/tasks", headers=header, params={"mine": True})).json()
            if t["case_id"] == request["id"]]
    assert [t["title"] for t in mine] == ["Text the requester", "Connect them with a pantry or meal program"]
    assert mine[0]["assigned_worker_name"] == "Wes Worker"

    done = await api.patch(f"/v1/tasks/{mine[0]['id']}", headers=header, json={"status": "done"})
    assert done.status_code == 200 and done.json()["completed_at"] is not None
    still_open = (await api.get("/v1/tasks", headers=header, params={"case_id": request["id"]})).json()
    assert [t["id"] for t in still_open] == [mine[1]["id"]]

    history = (await api.get(f"/v1/cases/{request['id']}", headers=header)).json()["updates"]
    assert history[-1]["content"] == "Task done: Text the requester"
    assert history[-1]["visibility"] == "internal"

    member = auth_header(f"auth0|{uuid4().hex}")
    assert (await api.get("/v1/tasks", headers=member)).status_code == 403


async def test_a_worker_adds_a_task_to_a_case(api, worker):
    request = (await api.post("/v1/public/requests", json={
        "description": "Need a ride to court on Monday.", "category": "transportation", "contact_method": "none",
    })).json()["request"]
    header = worker["header"]
    member = auth_header(f"auth0|{uuid4().hex}")
    member_id = (await api.get("/v1/me", headers=member)).json()["id"]

    added = await api.post(f"/v1/cases/{request['id']}/tasks", headers=header, json={
        "title": "Confirm the court date", "due_at": "2026-11-23T09:00:00Z", "assigned_worker_id": worker["id"],
    })
    assert added.status_code == 201
    task = added.json()
    assert (task["case_id"], task["title"], task["status"]) == (request["id"], "Confirm the court date", "open")
    assert (task["assigned_worker_id"], task["created_by"]) == (worker["id"], worker["id"])
    assert task["due_at"].startswith("2026-11-23T09:00:00")

    case = (await api.get(f"/v1/cases/{request['id']}", headers=header)).json()
    assert task["id"] in [t["id"] for t in case["tasks"]]
    assert case["updates"][-1]["content"] == "Task added: Confirm the court date"
    assert case["updates"][-1]["visibility"] == "internal"

    missing = await api.post(f"/v1/cases/{uuid4()}/tasks", headers=header, json={"title": "x"})
    to_member = await api.post(f"/v1/cases/{request['id']}/tasks", headers=header,
                               json={"title": "x", "assigned_worker_id": member_id})
    by_member = await api.post(f"/v1/cases/{request['id']}/tasks", headers=member, json={"title": "x"})
    assert (missing.status_code, missing.json()["code"]) == (404, "case_not_found")
    assert (to_member.status_code, to_member.json()["code"]) == (422, "not_a_worker")
    assert by_member.status_code == 403
