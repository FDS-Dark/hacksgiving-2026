"""The inbox over HTTP against real PostgreSQL, as the app role: who is
notified of what, one row per event, read state, per-user isolation,
preferences, and the task.remind job."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from databridge.task import TaskDatabridge
from models.notification import NotificationKind
from services.notification import NotificationService
from services.notification_jobs import TaskRemindStage
from tests.helpers import auth_header
from tests.integration.conftest import app_executor
from worker.runner import Runner


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
        "keisha": await _person(api, admin_conn, "Keisha"),
    }


async def _inbox(api, person) -> list[dict]:
    response = await api.get("/v1/notifications", headers=person["headers"])
    assert response.status_code == 200
    return response.json()


async def _case(api, person, **body) -> dict:
    response = await api.post("/v1/cases", headers=person["headers"], json={"title": "Ride to dialysis"} | body)
    assert response.status_code == 201
    return response.json()


async def _request(api, resident) -> dict:
    response = await api.post("/v1/requests", headers=resident["headers"], json={
        "description": "Need a ride to dialysis tomorrow morning.", "contact_name": "Keisha B."})
    assert response.status_code == 201
    return response.json()


async def test_an_assignment_by_someone_else_notifies_and_assigning_yourself_does_not(api, people):
    devon, maria = people["devon"], people["maria"]
    case = await _case(api, devon)

    assert (await api.patch(f"/v1/cases/{case['id']}", headers=devon["headers"],
                            json={"assigned_worker_id": maria["id"]})).status_code == 200
    (item,) = await _inbox(api, maria)
    assert item["kind"] == "assignment" and item["case_id"] == case["id"]
    assert item["title"] == f"Devon Lee assigned you #{case['number']}"
    assert item["body"] == "Ride to dialysis" and item["route"] == f"/staff/cases/{case['id']}"

    mine = await _case(api, maria)
    await api.patch(f"/v1/cases/{mine['id']}", headers=maria["headers"], json={"assigned_worker_id": maria["id"]})
    # Re-assigning the same person changes nothing, so it notifies nobody either.
    await api.patch(f"/v1/cases/{case['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})
    assert [i["case_id"] for i in await _inbox(api, maria)] == [case["id"]]


async def test_a_resident_reply_notifies_the_assignee(api, people):
    devon, maria, keisha = people["devon"], people["maria"], people["keisha"]
    request = await _request(api, keisha)
    await api.patch(f"/v1/cases/{request['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})

    reply = await api.post(f"/v1/requests/{request['id']}/replies", headers=keisha["headers"],
                           json={"content": "Yes, 7am works. Thank you!"})
    assert reply.status_code == 201

    latest = (await _inbox(api, maria))[0]
    assert latest["kind"] == "reply"
    assert latest["title"] == f"Keisha B. replied on #{request['number']}"
    assert latest["body"] == "“Yes, 7am works. Thank you!”"
    assert await _inbox(api, devon) == []


async def test_a_public_message_or_status_change_notifies_the_requester_and_shows_nothing_internal(api, people):
    devon, keisha = people["devon"], people["keisha"]
    request = await _request(api, keisha)

    await api.post(f"/v1/cases/{request['id']}/updates", headers=devon["headers"],
                   json={"content": "Internal: Devon thinks the address is wrong."})
    await api.post(f"/v1/cases/{request['id']}/updates", headers=devon["headers"],
                   json={"content": "We booked your ride for 7am.", "visibility": "public"})
    await api.patch(f"/v1/cases/{request['id']}", headers=devon["headers"],
                    json={"status": "in_progress", "priority": "high"})

    by_title = {i["title"]: i for i in await _inbox(api, keisha)}
    assert set(by_title) == {"ComForce replied", "Your request was updated"}
    message, status = by_title["ComForce replied"], by_title["Your request was updated"]
    assert (message["title"], message["body"]) == ("ComForce replied", "We booked your ride for 7am.")
    assert (status["title"], status["body"]) == ("Your request was updated", "Status: In progress")
    assert message["route"] == f"/help/request/{request['id']}"
    shown = str([message, status])
    assert "Devon" not in shown and "Internal" not in shown and "Keisha B." not in shown


async def test_the_same_event_twice_is_one_row(api, people, database):
    executor = app_executor(database)
    notifications = NotificationService(NotificationDatabridge(executor), executor)
    case = await _case(api, people["devon"])
    try:
        for _ in range(2):
            async with executor.transaction() as tx:
                await notifications.notify(
                    tx, user_id=people["maria"]["id"], kind=NotificationKind.ASSIGNMENT,
                    dedupe_key=f"assignment:{case['id']}", actor_id=people["devon"]["id"], case_id=case["id"],
                )
    finally:
        await executor.dispose()
    assert len(await _inbox(api, people["maria"])) == 1


async def test_read_state_unread_count_and_read_all(api, people):
    devon, maria = people["devon"], people["maria"]
    first, second, third = [await _case(api, devon, title=f"Case {n}") for n in range(3)]
    for case in (first, second, third):
        await api.patch(f"/v1/cases/{case['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})

    async def unread() -> int:
        return (await api.get("/v1/notifications/unread-count", headers=maria["headers"])).json()["count"]

    items = await _inbox(api, maria)
    assert [i["case_id"] for i in items] == [third["id"], second["id"], first["id"]]  # newest first
    assert await unread() == 3
    page = await api.get("/v1/notifications", headers=maria["headers"],
                         params={"before": items[0]["created_at"], "limit": 1})
    assert [i["id"] for i in page.json()] == [items[1]["id"]]

    opened = await api.get(f"/v1/notifications/{items[0]['id']}", headers=maria["headers"])
    assert opened.status_code == 200 and opened.json()["read_at"] is not None
    assert await unread() == 2

    one = await api.post("/v1/notifications/read-all", headers=maria["headers"], json={"case_id": second["id"]})
    assert one.json() == {"updated": 1} and await unread() == 1
    assert (await api.post(f"/v1/notifications/{items[2]['id']}/read", headers=maria["headers"])).status_code == 204
    assert await unread() == 0

    await api.patch(f"/v1/cases/{first['id']}", headers=devon["headers"], json={"status": "in_progress"})
    await api.patch(f"/v1/cases/{first['id']}", headers=devon["headers"], json={"assigned_worker_id": devon["id"]})
    await api.patch(f"/v1/cases/{first['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})
    everything = await api.post("/v1/notifications/read-all", headers=maria["headers"], json={})
    assert everything.json() == {"updated": 1} and await unread() == 0


async def test_nobody_reads_another_persons_notification(api, people):
    devon, maria, keisha = people["devon"], people["maria"], people["keisha"]
    case = await _case(api, devon)
    await api.patch(f"/v1/cases/{case['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})
    (item,) = await _inbox(api, maria)

    for other in (devon, keisha):
        assert (await api.get(f"/v1/notifications/{item['id']}", headers=other["headers"])).status_code == 404
        assert (await api.post(f"/v1/notifications/{item['id']}/read", headers=other["headers"])).status_code == 404
        assert (await api.post("/v1/notifications/read-all", headers=other["headers"],
                               json={"case_id": case["id"]})).json() == {"updated": 0}
    assert (await _inbox(api, maria))[0]["read_at"] is None
    assert (await api.get(f"/v1/notifications/{uuid4()}", headers=maria["headers"])).status_code == 404


async def test_preferences_start_at_the_defaults_and_patch_only_what_is_sent(api, people):
    headers = people["maria"]["headers"]
    defaults = await api.get("/v1/me/notification-preferences", headers=headers)
    assert defaults.json() == {"push_enabled": True, "muted_kinds": [], "quiet_start": None, "quiet_end": None,
                               "urgent_when_off_call": False}

    patched = await api.patch("/v1/me/notification-preferences", headers=headers,
                              json={"quiet_start": "21:00", "quiet_end": "07:00", "muted_kinds": ["reply"]})
    assert patched.status_code == 200
    assert patched.json() == {"push_enabled": True, "muted_kinds": ["reply"], "quiet_start": "21:00",
                              "quiet_end": "07:00", "urgent_when_off_call": False}

    cleared = await api.patch("/v1/me/notification-preferences", headers=headers,
                              json={"quiet_start": None, "urgent_when_off_call": True})
    assert cleared.json() == {"push_enabled": True, "muted_kinds": ["reply"], "quiet_start": None,
                              "quiet_end": "07:00", "urgent_when_off_call": True}
    assert (await api.get("/v1/me/notification-preferences", headers=headers)).json() == cleared.json()
    assert (await api.patch("/v1/me/notification-preferences", headers=headers,
                            json={"muted_kinds": ["nonsense"]})).status_code == 422


async def test_a_task_due_soon_reminds_its_owner(api, people, database):
    devon, maria = people["devon"], people["maria"]
    case = await _case(api, devon, assigned_worker_id=maria["id"])
    due = datetime.now(timezone.utc) + timedelta(minutes=10)
    task = (await api.post(f"/v1/cases/{case['id']}/tasks", headers=devon["headers"],
                           json={"title": "Confirm the pickup", "due_at": due.isoformat()})).json()

    executor = app_executor(database)
    try:
        jobs = JobDatabridge(executor)
        notifications = NotificationService(NotificationDatabridge(executor), executor)
        stage = TaskRemindStage(TaskDatabridge(executor), notifications)
        runner = Runner(jobs, executor, [stage], worker_id=f"test-{uuid4().hex[:6]}", lease_seconds=60)
        while await runner.tick():
            await runner.drain()
    finally:
        await executor.dispose()

    reminders = [i for i in await _inbox(api, maria) if i["kind"] == "task_due"]
    assert [(i["task_id"], i["title"], i["body"]) for i in reminders] == [
        (task["id"], "Task due soon", f"Confirm the pickup · #{case['number']}")]


async def _run_reminders(database) -> None:
    executor = app_executor(database)
    try:
        notifications = NotificationService(NotificationDatabridge(executor), executor)
        stage = TaskRemindStage(TaskDatabridge(executor), notifications)
        runner = Runner(JobDatabridge(executor), executor, [stage], worker_id=f"test-{uuid4().hex[:6]}",
                        lease_seconds=60)
        while await runner.tick():
            await runner.drain()
    finally:
        await executor.dispose()


async def test_a_task_reminder_follows_the_case_to_its_new_holder(api, people, database):
    """A task on an unheld case has no owner when its reminder runs; once the
    case is assigned, the reminder is queued again for the new holder."""
    devon, maria = people["devon"], people["maria"]
    case = await _case(api, devon)
    due = datetime.now(timezone.utc) + timedelta(minutes=10)
    task = (await api.post(f"/v1/cases/{case['id']}/tasks", headers=devon["headers"],
                           json={"title": "Call back", "due_at": due.isoformat()})).json()
    await _run_reminders(database)
    assert not [i for i in await _inbox(api, maria) if i["kind"] == "task_due"]

    await api.patch(f"/v1/cases/{case['id']}", headers=devon["headers"], json={"assigned_worker_id": maria["id"]})
    await _run_reminders(database)

    reminders = [i for i in await _inbox(api, maria) if i["kind"] == "task_due"]
    assert [i["task_id"] for i in reminders] == [task["id"]]


async def test_a_referral_status_change_by_someone_else_notifies_the_assignee(api, people):
    devon, maria = people["devon"], people["maria"]
    case = await _case(api, devon, assigned_worker_id=maria["id"], category="transportation")
    resource = (await api.get("/v1/resources", headers=devon["headers"])).json()[0]
    referral = (await api.post(f"/v1/cases/{case['id']}/referrals", headers=devon["headers"],
                               json={"resource_id": resource["id"]})).json()

    url = f"/v1/cases/{case['id']}/referrals/{referral['id']}"
    await api.patch(url, headers=devon["headers"], json={"status": "accepted", "outcome": "Pickup at 7am"})
    await api.patch(url, headers=devon["headers"], json={"outcome": "Driver confirmed"})
    await api.patch(url, headers=maria["headers"], json={"status": "completed"})

    (item,) = [i for i in await _inbox(api, maria) if i["kind"] == "referral_update"]
    # Live: the referral's current status.
    assert (item["title"], item["body"]) == ("Referral completed", f"{resource['name']} · #{case['number']}")


async def test_sql_gives_a_resident_no_internal_note_staff_name_or_staff_kind(api, people, database):
    """The masking lives in notification_view, not only in the renderer:
    rows that point at internal data come back without it."""
    devon, keisha = people["devon"], people["keisha"]
    request = await _request(api, keisha)
    note = (await api.post(f"/v1/cases/{request['id']}/updates", headers=devon["headers"],
                           json={"content": "Internal: neighbour says he is violent."})).json()

    executor = app_executor(database)
    try:
        notifications = NotificationDatabridge(executor)
        base = {"user_id": keisha["id"], "actor_id": devon["id"], "case_id": request["id"]}
        await notifications.create(**base, kind=NotificationKind.REQUEST_UPDATE, dedupe_key=f"update:{note['id']}",
                                   case_update_id=note["id"])
        staff_only = await notifications.create(**base, kind=NotificationKind.ASSIGNMENT, dedupe_key="assignment:x")
        (row,) = await notifications.list_for(keisha["id"], None, 50)
    finally:
        await executor.dispose()

    assert (row.update_content, row.update_type, row.actor_name, row.contact_name, row.reader_is_staff) == (
        None, None, None, None, False)
    assert (await api.get("/v1/notifications/unread-count", headers=keisha["headers"])).json() == {"count": 1}
    assert staff_only is not None
    assert (await api.get(f"/v1/notifications/{staff_only.id}", headers=keisha["headers"])).status_code == 404
