"""Team chat, requests for help to partners, who delivered a referral's help,
and "Export my records" (0031_team_chat_and_delivery.sql) over HTTP against
real PostgreSQL, as the app role."""

from uuid import UUID, uuid4

import pytest

from adapters.sms import FakeSms
from databridge.chat import ChatDatabridge
from databridge.case import CaseDatabridge
from databridge.export import ExportDatabridge
from databridge.insights import InsightsDatabridge
from databridge.notification import NotificationDatabridge
from databridge.partner import PartnerDatabridge
from dependencies import get_chat_service, get_export_service, get_insights_service, get_partner_service
from main import app
from services.chat import ChatService
from services.export import ExportService
from services.insights import InsightsService
from services.notification import NotificationService
from services.partner import PartnerService, PartnerTexter
from tests.helpers import auth_header
from tests.integration.conftest import app_executor


@pytest.fixture
async def executor(database):
    executor = app_executor(database)
    yield executor
    await executor.dispose()


@pytest.fixture
async def wired(api, executor):
    """The api client, plus this file's services on the test database. Texts
    are 'on' (sms_enabled), so a textable partner gets delivery sms."""
    notifications = NotificationService(NotificationDatabridge(executor), executor)
    app.dependency_overrides.update({
        get_chat_service: lambda: ChatService(ChatDatabridge(executor), notifications, executor),
        get_partner_service: lambda: PartnerService(
            PartnerDatabridge(executor), CaseDatabridge(executor), executor, sms_enabled=True),
        get_export_service: lambda: ExportService(ExportDatabridge(executor)),
        get_insights_service: lambda: InsightsService(InsightsDatabridge(executor), "America/Chicago"),
    })
    return api


async def _person(api, admin_conn, name: str, role: str = "member") -> dict:
    headers = auth_header(f"auth0|{uuid4().hex}", name=name)
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    if role != "member":
        await admin_conn.execute("UPDATE app.users SET role = $1 WHERE id = $2", role, user_id)
    return {"headers": headers, "id": user_id, "name": name}


@pytest.fixture
async def people(wired, admin_conn):
    return {
        "devon": await _person(wired, admin_conn, f"Devon {uuid4().hex[:4]}", "worker"),
        "maria": await _person(wired, admin_conn, f"Maria {uuid4().hex[:4]}", "worker"),
        "ada": await _person(wired, admin_conn, f"Ada {uuid4().hex[:4]}", "admin"),
        "keisha": await _person(wired, admin_conn, "Keisha"),
    }


def _channel(channels: list[dict], key: str) -> dict:
    return next(c for c in channels if c["key"] == key)


async def _chat_rows(api, person) -> list[dict]:
    items = (await api.get("/v1/notifications", headers=person["headers"])).json()
    return [i for i in items if i["kind"] in ("chat_message", "chat_rapid")]


async def test_team_chat_unread_inbox_and_rapid_response(wired, people, admin_conn):
    api, devon, maria = wired, people["devon"], people["maria"]
    for text in ("Anyone near N 27th St?", "Need a second person for a check-in."):
        sent = await api.post("/v1/chat/channels/team/messages", headers=devon["headers"], json={"body": text})
        assert sent.status_code == 201 and sent.json()["author_name"] == devon["name"]

    team = _channel((await api.get("/v1/chat/channels", headers=maria["headers"])).json(), "team")
    assert (team["name"], team["unread"], team["rapid_unread"]) == ("Team", 2, 0)
    assert team["last_message"] == "Need a second person for a check-in."
    assert _channel((await api.get("/v1/chat/channels", headers=devon["headers"])).json(), "team")["unread"] == 0
    # Ordinary messages: one inbox row per unread streak, and no push job.
    (row,) = await _chat_rows(api, maria)
    assert (row["kind"], row["title"], row["route"]) == ("chat_message", "New messages in Team chat",
                                                         "/staff/chat/team")
    assert await admin_conn.fetchval(
        "SELECT count(*) FROM app.jobs j JOIN app.notifications n ON j.dedupe_key = 'notification:' || n.id "
        "WHERE n.user_id = $1 AND n.kind = 'chat_message'", maria["id"]) == 0

    thread = (await api.get("/v1/chat/channels/team", headers=maria["headers"])).json()
    bodies = [m["body"] for m in thread["messages"]]
    assert bodies[-2:] == ["Anyone near N 27th St?", "Need a second person for a check-in."]
    read = await api.post("/v1/chat/channels/team/read", headers=maria["headers"])
    assert read.status_code == 200 and read.json()["notifications_read"] == 1
    assert _channel((await api.get("/v1/chat/channels", headers=maria["headers"])).json(), "team")["unread"] == 0
    after = (await api.get("/v1/chat/channels/team", headers=devon["headers"])).json()["messages"][-1]
    assert after["read_by"] >= 1

    rapid = await api.post("/v1/chat/channels/team/messages", headers=devon["headers"],
                           json={"body": "Shots fired report at 27th & Center, hold visits.", "rapid": True})
    assert rapid.status_code == 201 and rapid.json()["rapid"] is True
    rows = await _chat_rows(api, maria)
    assert rows[0]["kind"] == "chat_rapid" and rows[0]["title"] == "Rapid response in Team chat"
    assert "27th" not in rows[0]["title"] + rows[0]["body"]
    assert await admin_conn.fetchval(
        "SELECT count(*) FROM app.jobs j JOIN app.notifications n ON j.dedupe_key = 'notification:' || n.id "
        "WHERE n.user_id = $1 AND n.kind = 'chat_rapid'", maria["id"]) == 1
    # The second row of a new streak (Maria read before the rapid one).
    assert _channel((await api.get("/v1/chat/channels", headers=maria["headers"])).json(), "team")[
        "rapid_unread"] == 1


async def test_on_call_channel_reaches_who_is_on_now_and_admins(wired, people, admin_conn):
    api, devon, maria, ada = wired, people["devon"], people["maria"], people["ada"]
    await admin_conn.execute("DELETE FROM app.oncall_shifts")
    await admin_conn.execute(
        "INSERT INTO app.oncall_shifts (user_id, starts_at, ends_at, rank, source) "
        "VALUES ($1, now() - interval '1 hour', now() + interval '2 hours', 1, 'schedule')", maria["id"])
    sent = await api.post("/v1/chat/channels/oncall/messages", headers=devon["headers"],
                          json={"body": "Taking the 9pm call?", "rapid": True})
    assert sent.status_code == 201
    assert [r["route"] for r in await _chat_rows(api, maria)] == ["/staff/chat/oncall"]
    assert [r["title"] for r in await _chat_rows(api, ada)] == ["Rapid response in On call chat"]
    # Devon isn't on call: he wrote it, and isn't paged about other on-call messages either.
    await api.post("/v1/chat/channels/oncall/messages", headers=maria["headers"], json={"body": "Yes, on it."})
    assert await _chat_rows(api, devon) == []
    await admin_conn.execute("DELETE FROM app.oncall_shifts")


async def test_a_case_channel_is_staff_only(wired, people):
    api, devon, maria, keisha = wired, people["devon"], people["maria"], people["keisha"]
    request = (await api.post("/v1/requests", headers=keisha["headers"], json={
        "description": "Need a ride to dialysis tomorrow morning.", "contact_name": "Keisha B."})).json()
    await api.patch(f"/v1/cases/{request['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})

    empty = await api.get(f"/v1/chat/channels/{request['id']}", headers=devon["headers"])
    assert empty.status_code == 200
    assert (empty.json()["channel"]["name"], empty.json()["messages"]) == (f"Case #{request['number']}", [])
    sent = await api.post(f"/v1/chat/channels/{request['id']}/messages", headers=devon["headers"],
                          json={"body": "Can you call her before 8?"})
    assert sent.status_code == 201
    (row,) = await _chat_rows(api, maria)  # the assignee
    assert row["route"] == f"/staff/chat/{request['id']}" and row["case_id"] == request["id"]
    assert request["id"] in [c["key"] for c in (await api.get("/v1/chat/channels", headers=maria["headers"])).json()]

    for method, path in (("get", "/v1/chat/channels"), ("get", f"/v1/chat/channels/{request['id']}"),
                         ("post", "/v1/chat/channels/team/read")):
        assert (await getattr(api, method)(path, headers=keisha["headers"])).status_code == 403
    denied = await api.post(f"/v1/chat/channels/{request['id']}/messages", headers=keisha["headers"],
                            json={"body": "hi"})
    assert denied.status_code == 403
    assert await _chat_rows(api, keisha) == []
    assert (await api.get("/v1/chat/channels/nope", headers=devon["headers"])).status_code == 404
    assert (await api.get(f"/v1/chat/channels/{uuid4()}", headers=devon["headers"])).status_code == 404


async def test_a_partner_request_sends_no_contact_details_without_a_share(wired, people, executor):
    api, devon = wired, people["devon"]
    case = (await api.post("/v1/cases", headers=devon["headers"], json={
        "title": "Family needs a bed", "description": "Sleeping in the car with two kids.",
        "category": "homelessness", "location": "N 27th St & W Center St", "contact_name": "Dana R.",
        "contact_phone": "414-555-0199", "contact_email": "dana@example.org"})).json()
    textable = (await api.post("/v1/partners", headers=devon["headers"], json={
        "name": "Harbor House", "phone": "414-555-0100", "accepts_shares": True})).json()
    emailed = (await api.post("/v1/partners", headers=devon["headers"], json={
        "name": "Northside Pantry", "email": "help@example.org"})).json()

    asked = await api.post(f"/v1/cases/{case['id']}/partner-requests", headers=devon["headers"], json={
        "partner_id": emailed["id"], "need": "meal_programs", "note": "Groceries for a family of three this week?"})
    assert asked.status_code == 201
    body = asked.json()
    assert (body["request"]["delivery"], body["request"]["status"]) == ("compose", "composed")
    for private in ("Dana", "414-555-0199", "dana@example.org", "27th", "Sleeping"):
        assert private not in body["message"]
    assert f"case #{case['number']}" in body["message"] and "Food" in body["message"]

    texted = (await api.post(f"/v1/cases/{case['id']}/partner-requests", headers=devon["headers"], json={
        "partner_id": textable["id"], "need": "homelessness", "note": "A family bed tonight?"})).json()
    assert (texted["request"]["delivery"], texted["request"]["status"]) == ("sms", "pending")
    assert "414-555-0199" not in texted["message"]

    # With a live consented share that included contact details, they go too.
    await api.post(f"/v1/cases/{case['id']}/shares", headers=devon["headers"], json={
        "partner_id": textable["id"], "purpose": "Bed tonight", "consent": True, "consent_method": "verbal",
        "include_contact": True})
    shared = (await api.post(f"/v1/cases/{case['id']}/partner-requests", headers=devon["headers"], json={
        "partner_id": textable["id"], "need": "homelessness", "note": "Following up on the bed."})).json()
    assert shared["request"]["included_contact"] is True and "414-555-0199" in shared["message"]
    assert "dana@example.org" not in shared["message"]

    sms = FakeSms()
    assert await PartnerTexter(PartnerDatabridge(executor), sms).sweep() >= 2
    assert ("+14145550100", texted["message"]) in sms.sent
    listed = (await api.get(f"/v1/cases/{case['id']}/partner-requests", headers=devon["headers"])).json()
    assert {r["partner_name"]: r["status"] for r in listed} == {"Harbor House": "sent", "Northside Pantry": "composed"}

    history = [u["content"] for u in (await api.get(f"/v1/cases/{case['id']}", headers=devon["headers"])).json()[
        "updates"]]
    assert "Asked Northside Pantry for help (by email or phone): Groceries for a family of three this week?" in history
    assert any(h.startswith("Asked Harbor House for help (by text)") for h in history)


async def test_a_completed_referral_records_who_delivered_it(wired, people, admin_conn):
    api, devon, maria = wired, people["devon"], people["maria"]
    case = (await api.post("/v1/cases", headers=devon["headers"], json={
        "title": "Ride to dialysis", "category": "transportation"})).json()
    resource = (await api.post("/v1/resources", headers=devon["headers"], json={
        "name": f"Ride Line {uuid4().hex[:4]}", "category": "transportation"})).json()
    referral = (await api.post(f"/v1/cases/{case['id']}/referrals", headers=devon["headers"],
                               json={"resource_id": resource["id"]})).json()
    assert referral["delivered_by"] is None

    early = await api.patch(f"/v1/cases/{case['id']}/referrals/{referral['id']}", headers=devon["headers"],
                            json={"delivered_by": "provider"})
    assert early.status_code == 422  # not completed yet

    done = (await api.patch(f"/v1/cases/{case['id']}/referrals/{referral['id']}", headers=devon["headers"],
                            json={"status": "completed"})).json()
    assert (done["delivered_by"], done["confirmed_by_name"]) == ("provider", devon["name"])
    assert done["confirmed_at"] is not None

    ours = (await api.patch(f"/v1/cases/{case['id']}/referrals/{referral['id']}", headers=devon["headers"],
                            json={"delivered_by": "comforce", "delivered_by_worker_id": maria["id"]})).json()
    assert (ours["delivered_by"], ours["delivered_by_worker_name"]) == ("comforce", maria["name"])

    history = [u["content"] for u in (await api.get(f"/v1/cases/{case['id']}", headers=devon["headers"])).json()[
        "updates"]]
    assert f"Referral to {resource['name']} marked completed. Delivered by {resource['name']} · confirmed by " \
           f"{devon['name']}." in history
    assert f"Delivered by ComForce MKE ({maria['name']}) · confirmed by {devon['name']}." in history

    # Insights' period ends at the API's clock; a database container's clock can run a little ahead.
    await admin_conn.execute("UPDATE app.case_referrals SET confirmed_at = confirmed_at - interval '1 minute' "
                             "WHERE id = $1", UUID(referral["id"]))
    insights = (await api.get("/v1/insights", headers=devon["headers"], params={"days": 7})).json()
    assert any(d["provider"] == "ComForce MKE" and d["delivered_by"] == "comforce" and d["helped"] >= 1
               for d in insights["delivered_by"])

    reopened = (await api.patch(f"/v1/cases/{case['id']}/referrals/{referral['id']}", headers=devon["headers"],
                                json={"status": "accepted"})).json()
    assert (reopened["delivered_by"], reopened["confirmed_by"]) == (None, None)


async def test_export_holds_only_my_records_and_no_contact_details(wired, people, admin_conn):
    api, devon, maria, keisha = wired, people["devon"], people["maria"], people["keisha"]
    request = (await api.post("/v1/requests", headers=keisha["headers"], json={
        "description": "Need a ride to dialysis tomorrow morning.", "contact_name": "Keisha Bright",
        "contact_phone": "414-555-0142", "contact_email": "keisha@example.org"})).json()
    await api.patch(f"/v1/cases/{request['id']}", headers=devon["headers"],
                    json={"assigned_worker_id": devon["id"], "status": "resolved"})
    title = f"Maria only {uuid4().hex[:6]}"
    hers = (await api.post("/v1/cases", headers=maria["headers"], json={"title": title})).json()
    await admin_conn.execute(
        "INSERT INTO app.records (author_id, source, status, stage, raw_text, redacted_text, extraction, case_id) "
        "VALUES ($1, 'text', 'confirmed', 'done', 'Met Keisha Bright at 414-555-0142', 'Met [name]', "
        "'{\"title\": \"Ride needed\", \"summary\": \"Needs a ride to dialysis.\", \"category\": \"transportation\","
        " \"risk_flags\": [\"=cmd\"]}'::jsonb, $2)", devon["id"], request["id"])
    task = await admin_conn.fetchval(
        "INSERT INTO app.tasks (case_id, title, status, completed_at, completed_by) "
        "VALUES ($1, 'Call about the ride', 'done', now() - interval '1 hour', $2) RETURNING id",
        request["id"], devon["id"])
    assert task is not None

    response = await api.get("/v1/me/export", headers=devon["headers"])
    assert response.status_code == 200
    export = response.json()
    text = export["csv"]
    assert export["filename"].startswith("comforce-records-") and export["filename"].endswith(".csv")
    assert export["summary"]["debriefs"] == 1 and export["summary"]["tasks_completed"] == 1
    assert export["summary"]["cases"] >= 1 and export["summary"]["people_helped"] >= 1
    assert "Needs a ride to dialysis." in text and "Call about the ride" in text
    assert f"{request['number']}" in text
    for private in ("414-555-0142", "keisha@example.org", "Keisha Bright", "Met [name]", hers["title"]):
        assert private not in text
    assert "'=cmd" in text  # a cell a spreadsheet would run is defused

    theirs = (await api.get("/v1/me/export", headers=maria["headers"])).json()
    assert hers["title"] in theirs["csv"] and "Call about the ride" not in theirs["csv"]
    assert theirs["summary"]["debriefs"] == 0
    assert (await api.get("/v1/me/export", headers=keisha["headers"])).status_code == 403
