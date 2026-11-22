"""Shift handoff briefs over HTTP against real PostgreSQL: going off call
leaves the next person a snapshot of open cases and tasks, readable by
both; the AI rewrite is optional."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from dependencies import get_handoff_service
from main import app
from tests.helpers import auth_header


@pytest.fixture
async def people(api, admin_conn):
    await admin_conn.execute("DELETE FROM app.oncall_shifts")
    found = {}
    for key, name in (("maria", "Maria Santos"), ("devon", "Devon Park")):
        header = auth_header(f"auth0|{uuid4().hex}", name=name)
        user_id = (await api.get("/v1/me", headers=header)).json()["id"]
        await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", user_id)
        found[key], found[f"{key}_id"] = header, user_id
    return found


async def test_going_off_call_hands_over_open_cases_and_tasks(api, people):
    maria, devon = people["maria"], people["devon"]
    tag = uuid4().hex[:6]
    assert (await api.post("/v1/oncall/me", headers=devon, json={"on": True})).status_code == 200
    assert (await api.post("/v1/oncall/me", headers=maria, json={"on": True})).status_code == 200

    case = (await api.post("/v1/cases", headers=maria, json={
        "title": f"Family needs a bed {tag}", "category": "homelessness", "priority": "medium",
        "assigned_worker_id": people["maria_id"],
    })).json()
    overdue = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    task = await api.post(f"/v1/cases/{case['id']}/tasks", headers=maria,
                          json={"title": f"Call the shelter {tag}", "due_at": overdue})
    assert task.status_code == 201, task.text

    off = await api.post("/v1/oncall/me", headers=maria, json={"on": False})
    assert off.status_code == 200 and off.json()["me"]["on_call"] is False

    (brief,) = (await api.get("/v1/oncall/handoffs", headers=maria)).json()
    assert brief["recipient_id"] == people["devon_id"] and brief["author_name"] == "Maria Santos"
    assert [c["id"] for c in brief["brief"]["cases"]] == [case["id"]]
    (handed_task,) = [t for t in brief["brief"]["tasks"] if t["title"] == f"Call the shelter {tag}"]
    assert handed_task["overdue"] is True
    assert brief["summary_source"] == "rules" and "1 open case" in brief["summary"] and "overdue" in brief["summary"]

    # Devon was handed it, so it's in his list too.
    assert [b["id"] for b in (await api.get("/v1/oncall/handoffs", headers=devon)).json()] == [brief["id"]]
    # Going off again while already off writes nothing new.
    await api.post("/v1/oncall/me", headers=maria, json={"on": False})
    assert len((await api.get("/v1/oncall/handoffs", headers=maria)).json()) == 1


async def test_the_ai_rewrites_the_summary_when_set_up(api, people):
    maria = people["maria"]
    await api.post("/v1/oncall/me", headers=maria, json={"on": True})
    await api.post("/v1/cases", headers=maria, json={
        "title": "Ride to court", "category": "transportation", "assigned_worker_id": people["maria_id"]})
    await api.post("/v1/oncall/me", headers=maria, json={"on": False})
    (brief,) = (await api.get("/v1/oncall/handoffs", headers=maria)).json()
    assert brief["recipient_id"] is None  # nobody else was on or next

    service = app.dependency_overrides[get_handoff_service]()
    seen: list[str] = []

    class FakeAssistant:
        async def _ask(self, instructions, prompt, schema):
            seen.append(prompt)
            return schema(summary="Ride to court still needs booking.")

    original, service.assistant = service.assistant, FakeAssistant()
    try:
        out = await api.post(f"/v1/oncall/handoffs/{brief['id']}/summarize", headers=maria)
    finally:
        service.assistant = original
    assert out.status_code == 200, out.text
    assert out.json()["summary"] == "Ride to court still needs booking." and out.json()["summary_source"] == "ai"
    assert "Ride to court" in seen[0]

    service.assistant = None
    try:
        unavailable = await api.post(f"/v1/oncall/handoffs/{brief['id']}/summarize", headers=maria)
    finally:
        service.assistant = original
    assert unavailable.status_code == 503
