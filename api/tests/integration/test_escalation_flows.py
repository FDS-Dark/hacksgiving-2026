"""Urgent escalation over HTTP against real PostgreSQL, as the app role: an
urgent unassigned case is offered to whoever is on call, step by step
(services/oncall_jobs.py, run here with the worker's Runner), and staff
accept, pass and arrive (docs/design/push-escalation-contract.md phase 3)."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import asyncpg
import pytest

from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from databridge.oncall import OncallDatabridge
from databridge.staff import StaffDatabridge
from databridge.task import TaskDatabridge
from dependencies import get_triager
from main import app
from models.case_enums import CaseCategory
from services.case import Triage
from services.notification import NotificationService
from services.oncall import OncallService
from services.oncall_jobs import EscalateStage, OfferStage, RemindStage
from services.pipeline import Stage
from services.rate_limit import anonymous_submissions
from services.staff import StaffService
from services.task import TaskService
from tests.helpers import auth_header
from tests.integration.conftest import _db_url, app_executor
from worker.runner import Runner


@pytest.fixture
async def people(api, admin_conn):
    """An admin, three workers and a resident. Nobody else is staff, on call
    or paged: shifts, alerts and their jobs from other tests are cleared."""
    await admin_conn.execute("DELETE FROM app.oncall_shifts")
    await admin_conn.execute("DELETE FROM app.oncall_alerts")
    await admin_conn.execute("DELETE FROM app.jobs WHERE kind LIKE 'oncall.%'")
    await admin_conn.execute("UPDATE app.users SET role = 'member' WHERE role IN ('worker', 'admin')")
    found = {}
    for key, role, name in (
        ("admin", "admin", "Ada Admin"), ("maria", "worker", "Maria Santos"), ("devon", "worker", "Devon Park"),
        ("ana", "worker", "Ana Ruiz"), ("keisha", "member", "Keisha"),
    ):
        header = auth_header(f"auth0|{uuid4().hex}", name=name)
        user_id = (await api.get("/v1/me", headers=header)).json()["id"]
        await admin_conn.execute("UPDATE app.users SET role = $1 WHERE id = $2", role, user_id)
        found[key], found[f"{key}_id"] = header, user_id
    return found


@pytest.fixture
def urgent_triage():
    """Resident requests are urgent only when triage says so."""
    async def triage(text: str) -> Triage:
        return Triage(category=CaseCategory.INCIDENT_DEESCALATION, urgent=True, reason="Someone may be hurt.")

    app.dependency_overrides[get_triager] = lambda: triage
    anonymous_submissions.reset()
    yield
    anonymous_submissions.reset()


# Jobs due within this long count as due: the test database's clock (Docker's
# VM) can step back a second or so between queueing a job and claiming it.
CLOCK_SLACK = timedelta(seconds=5)


async def _nudge_due_jobs(database) -> None:
    conn = await asyncpg.connect(_db_url(database))
    try:
        await conn.execute(
            "UPDATE app.jobs SET run_at = now() - interval '1 minute' "
            "WHERE kind LIKE 'oncall.%' AND status = 'queued' AND run_at <= now() + $1",
            CLOCK_SLACK)
    finally:
        await conn.close()


async def run_jobs(database) -> None:
    """Everything the worker would run now (oncall.* jobs that are due)."""
    executor = app_executor(database)
    try:
        jobs, alerts = JobDatabridge(executor), OncallDatabridge(executor)
        notifications = NotificationService(NotificationDatabridge(executor), executor)
        stages: list[Stage] = [
            OfferStage(alerts, jobs, notifications, 300),
            EscalateStage(alerts, jobs),
            RemindStage(alerts, jobs, notifications, 600, 3),
        ]
        runner = Runner(jobs, executor, stages, worker_id=f"test-{uuid4().hex[:6]}", lease_seconds=60)
        while True:
            await _nudge_due_jobs(database)
            if not await runner.tick():
                break
            await runner.drain()
    finally:
        await executor.dispose()


async def due_now(admin_conn, kind: str) -> None:
    """The timer ran out: queued jobs of `kind` are due. A minute back, as
    the test database's clock (Docker's VM) can step back a second or so."""
    await admin_conn.execute(
        "UPDATE app.jobs SET run_at = now() - interval '1 minute' WHERE kind = $1 AND status = 'queued'", kind)


async def on_call(api, people, who: str, rank: int = 1) -> None:
    now = datetime.now(timezone.utc)
    response = await api.post("/v1/oncall/shifts", headers=people["admin"], json={
        "user_id": people[f"{who}_id"], "starts_at": (now - timedelta(hours=1)).isoformat(),
        "ends_at": (now + timedelta(hours=4)).isoformat(), "rank": rank})
    assert response.status_code == 201


async def urgent_case(api, people, **body) -> dict:
    response = await api.post("/v1/cases", headers=people["admin"], json={
        "title": "Fight outside the corner store", "priority": "high", "category": "incident_deescalation",
        "description": "Two men shouting, one has a bat.", "location": "N 27th St & W Center St",
        "contact_phone": "414-555-0142", "contact_name": "Store owner"} | body)
    assert response.status_code == 201
    return response.json()


async def alert_for(api, header, case_id: str, open_only: bool = False) -> dict:
    alerts = (await api.get("/v1/oncall/alerts", headers=header, params={"open_only": open_only})).json()
    (alert,) = [a for a in alerts if a["case_id"] == case_id]
    return alert


async def detail(api, header, alert_id: str) -> dict:
    response = await api.get(f"/v1/oncall/alerts/{alert_id}", headers=header)
    assert response.status_code == 200
    return response.json()


async def inbox(api, header, kind: str) -> list[dict]:
    return [i for i in (await api.get("/v1/notifications", headers=header)).json() if i["kind"] == kind]


async def test_an_urgent_resident_request_is_offered_to_whoever_is_on_call(api, people, database, urgent_triage):
    await on_call(api, people, "maria")
    await on_call(api, people, "devon", rank=2)
    sent = await api.post("/v1/requests", headers=people["keisha"], json={
        "description": "A man is threatening people outside the laundromat.", "contact_name": "Keisha B.",
        "contact_method": "call", "contact_phone": "414-555-0199"})
    assert sent.status_code == 201
    case_id = sent.json()["id"]

    # The alert opened with the request; nobody is offered until the job runs.
    alert = await alert_for(api, people["maria"], case_id, open_only=True)
    assert (alert["status"], alert["step"], alert["my_offer"]) == ("offering", 1, None)

    await run_jobs(database)
    (offer,) = await inbox(api, people["maria"], "urgent_offer")
    assert offer["title"] == f"Urgent: {alert['case_title']}"
    assert offer["body"] == "You're on call. Open it to accept or pass."
    assert offer["route"] == f"/staff/alerts/{alert['id']}" and offer["alert_id"] == alert["id"]
    assert await inbox(api, people["devon"], "urgent_offer") == []

    shown = await detail(api, people["maria"], alert["id"])
    mine = shown["my_offer"]
    assert mine["outcome"] == "pending" and mine["step"] == 1
    left = datetime.fromisoformat(mine["expires_at"]) - datetime.now(timezone.utc)
    # Five minutes (give or take the database's clock).
    assert timedelta(minutes=4) < left < timedelta(minutes=5, seconds=10)
    assert shown["next_name"] == "Devon Park"
    assert shown["category"] == "incident_deescalation" and shown["contact_method"] == "call"
    assert "414-555-0199" not in str(shown) and "Keisha B." not in str(shown)

    # By access code too.
    anonymous = await api.post("/v1/public/requests", json={"description": "Someone collapsed at the bus stop."})
    assert anonymous.status_code == 201
    other = await alert_for(api, people["maria"], anonymous.json()["request"]["id"], open_only=True)
    assert other["status"] == "offering"


async def test_the_step_timer_moves_it_to_the_next_person(api, people, database, admin_conn):
    await on_call(api, people, "maria")
    await on_call(api, people, "devon", rank=2)
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])
    assert alert["step"] == 1 and alert["my_offer"]["outcome"] == "pending"

    await due_now(admin_conn, "oncall.escalate")
    await run_jobs(database)

    assert (await detail(api, people["maria"], alert["id"]))["my_offer"]["outcome"] == "timed_out"
    moved = await detail(api, people["devon"], alert["id"])
    assert (moved["status"], moved["step"], moved["my_offer"]["outcome"]) == ("offering", 2, "pending")
    # Step 3 (the admin, the fallback) is next.
    assert moved["next_name"] == "Ada Admin"
    assert len(await inbox(api, people["devon"], "urgent_offer")) == 1


async def test_two_accepts_at_once_one_wins(api, people, database):
    await on_call(api, people, "maria")
    await on_call(api, people, "devon")
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])

    responses = await asyncio.gather(
        api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["maria"]),
        api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["devon"]),
    )
    assert sorted(r.status_code for r in responses) == [200, 409]
    won = next(r for r in responses if r.status_code == 200).json()
    lost = next(r for r in responses if r.status_code == 409).json()
    winner = "maria" if won["accepted_by"] == people["maria_id"] else "devon"
    loser = "devon" if winner == "maria" else "maria"
    assert won["status"] == "accepted" and won["my_offer"]["outcome"] == "accepted"
    assert lost["code"] == "already_accepted" and won["accepted_by_name"] in lost["message"]

    # The loser's offer was superseded; the case is the winner's and in progress.
    assert (await detail(api, people[loser], alert["id"]))["my_offer"]["outcome"] == "superseded"
    held = (await api.get(f"/v1/cases/{case['id']}", headers=people["admin"])).json()
    assert held["case"]["assigned_worker_id"] == people[f"{winner}_id"]
    assert held["case"]["status"] == "in_progress"
    entries = [(u["update_type"], u["visibility"], u["content"]) for u in held["updates"]]
    assert ("assignment", "internal", f"Assigned to {won['accepted_by_name']}.") in entries
    (accepted,) = [e for e in entries if e[0] == "alert"]
    assert accepted[1] == "internal" and accepted[2].startswith("Accepted on call after 0:")
    assert accepted[2].endswith(", step 1")

    # Anyone may accept while it's open, but not once it's taken, even an admin.
    again = await api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["admin"])
    assert again.status_code == 409 and again.json()["code"] == "already_accepted"


async def test_when_everyone_in_the_step_passes_it_moves_on_at_once(api, people, database, admin_conn):
    await on_call(api, people, "maria")
    await on_call(api, people, "ana")
    await on_call(api, people, "devon", rank=2)
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])
    url = f"/v1/oncall/alerts/{alert['id']}/pass"

    first = await api.post(url, headers=people["maria"], json={"reason": "busy"})
    assert first.status_code == 200 and first.json()["step"] == 1
    assert first.json()["my_offer"]["outcome"] == "passed"
    # Passing twice, or without an offer, isn't possible.
    assert (await api.post(url, headers=people["maria"], json={})).json()["code"] == "not_offered"
    assert (await api.post(url, headers=people["devon"])).json()["code"] == "not_offered"
    assert (await api.post(url, headers=people["maria"], json={"reason": "tired"})).status_code == 422

    second = await api.post(url, headers=people["ana"], json={"reason": "too_far"})
    assert second.status_code == 200 and second.json()["step"] == 2
    await run_jobs(database)
    moved = await detail(api, people["devon"], alert["id"])
    assert moved["step"] == 2 and moved["my_offer"]["outcome"] == "pending"

    # Step 1's timer then finds the step changed and does nothing.
    await due_now(admin_conn, "oncall.escalate")
    await admin_conn.execute(
        "UPDATE app.jobs SET run_at = now() + interval '1 hour' WHERE dedupe_key = $1",
        f"alert:{alert['id']}:escalate:2")
    await run_jobs(database)
    still = await detail(api, people["devon"], alert["id"])
    assert (still["status"], still["step"], still["my_offer"]["outcome"]) == ("offering", 2, "pending")


async def test_the_timer_after_an_accept_does_nothing(api, people, database, admin_conn):
    await on_call(api, people, "maria")
    await on_call(api, people, "devon", rank=2)
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])
    assert (await api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["maria"])).status_code == 200

    await due_now(admin_conn, "oncall.escalate")
    await run_jobs(database)

    after = await detail(api, people["maria"], alert["id"])
    assert (after["status"], after["step"], after["my_offer"]["outcome"]) == ("accepted", 1, "accepted")
    assert await inbox(api, people["devon"], "urgent_offer") == []
    assert (await detail(api, people["devon"], alert["id"]))["my_offer"] is None


async def test_nobody_on_call_goes_straight_to_the_fallback(api, people, database, admin_conn):
    await admin_conn.execute(
        "INSERT INTO app.notification_preferences (user_id, urgent_when_off_call) VALUES ($1, true)",
        people["ana_id"])
    case = await urgent_case(api, people)
    await run_jobs(database)

    alert = await alert_for(api, people["admin"], case["id"])
    assert alert["step"] == 3 and alert["my_offer"]["outcome"] == "pending" and alert["next_name"] is None
    assert len(await inbox(api, people["ana"], "urgent_offer")) == 1
    assert await inbox(api, people["maria"], "urgent_offer") == []


async def test_unanswered_reminds_admins_at_most_three_times(api, people, database, admin_conn):
    case = await urgent_case(api, people)
    await run_jobs(database)
    await due_now(admin_conn, "oncall.escalate")
    await run_jobs(database)

    alert = await alert_for(api, people["maria"], case["id"], open_only=True)
    assert alert["status"] == "unanswered"
    (first,) = await inbox(api, people["admin"], "urgent_unanswered")
    assert first["title"] == f"Nobody has accepted #{case['number']}"
    assert first["body"] == case["title"] and first["route"] == f"/staff/alerts/{alert['id']}"

    for _ in range(4):
        await due_now(admin_conn, "oncall.remind")
        await run_jobs(database)
    assert len(await inbox(api, people["admin"], "urgent_unanswered")) == 3
    assert await inbox(api, people["maria"], "urgent_unanswered") == []

    # Still open to anyone: a worker who was never offered accepts it.
    taken = await api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["maria"])
    assert taken.status_code == 200 and taken.json()["status"] == "accepted"


async def test_assigning_by_hand_resolves_and_closing_cancels(api, people, database):
    await on_call(api, people, "maria")
    assigned, closed = await urgent_case(api, people), await urgent_case(api, people, title="Second one")
    first = await alert_for(api, people["admin"], assigned["id"])
    second = await alert_for(api, people["admin"], closed["id"])

    await api.patch(f"/v1/cases/{assigned['id']}", headers=people["admin"],
                    json={"assigned_worker_id": people["devon_id"]})
    await api.patch(f"/v1/cases/{closed['id']}", headers=people["admin"], json={"status": "closed"})
    assert (await detail(api, people["admin"], first["id"]))["status"] == "resolved"
    assert (await detail(api, people["admin"], second["id"]))["status"] == "cancelled"

    # Their offer jobs then do nothing.
    await run_jobs(database)
    assert await inbox(api, people["maria"], "urgent_offer") == []
    late = await api.post(f"/v1/oncall/alerts/{first['id']}/accept", headers=people["maria"])
    assert late.status_code == 409 and late.json()["code"] == "alert_closed"

    # Unassigning it again pages again, with a new alert.
    await api.patch(f"/v1/cases/{assigned['id']}", headers=people["admin"], json={"assigned_worker_id": None})
    again = await alert_for(api, people["admin"], assigned["id"], open_only=True)
    assert again["id"] != first["id"] and again["status"] == "offering"


async def test_raising_the_priority_pages(api, people):
    case = await urgent_case(api, people, priority="medium")
    assert [a for a in (await api.get("/v1/oncall/alerts", headers=people["admin"])).json()
            if a["case_id"] == case["id"]] == []
    await api.patch(f"/v1/cases/{case['id']}", headers=people["admin"], json={"priority": "critical"})
    assert (await alert_for(api, people["admin"], case["id"]))["status"] == "offering"


async def test_the_sweeper_opens_a_missed_alert(api, people, database, admin_conn):
    missed = await admin_conn.fetchval(
        "INSERT INTO app.cases (title, priority, source) VALUES ('Missed by a code path', 'critical', 'worker') "
        "RETURNING id")
    executor = app_executor(database)
    try:
        notifications = NotificationService(NotificationDatabridge(executor), executor)
        jobs = JobDatabridge(executor)
        tasks = TaskService(TaskDatabridge(executor), StaffService(StaffDatabridge(executor)), jobs, executor)
        oncall = OncallService(OncallDatabridge(executor), executor, ZoneInfo("America/Chicago"),
                               jobs=jobs, notifications=notifications, tasks=tasks)
        assert await oncall.sweep() >= 1
        await oncall.sweep()
    finally:
        await executor.dispose()

    alert = await alert_for(api, people["admin"], str(missed))
    assert alert["status"] == "offering"
    queued = await admin_conn.fetchval(
        "SELECT count(*) FROM app.jobs WHERE dedupe_key = $1", f"alert:{alert['id']}:offer:1")
    assert queued == 1


async def test_arrived_is_for_the_acceptor(api, people, database):
    await on_call(api, people, "maria")
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])
    url = f"/v1/oncall/alerts/{alert['id']}/arrived"
    assert (await api.post(url, headers=people["maria"])).status_code == 403  # not accepted yet
    await api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["maria"])

    assert (await api.post(url, headers=people["devon"])).status_code == 403
    there = await api.post(url, headers=people["maria"])
    assert there.status_code == 200 and there.json()["arrived_at"] is not None
    await api.post(url, headers=people["maria"])
    history = (await api.get(f"/v1/cases/{case['id']}", headers=people["admin"])).json()["updates"]
    assert [u["content"] for u in history if u["content"] == "On scene"] == ["On scene"]


async def test_accepting_again_as_the_acceptor_succeeds(api, people, database):
    """The first answer was lost on a bad connection: tapping again is a 200,
    not a 409 naming yourself."""
    await on_call(api, people, "maria")
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])
    url = f"/v1/oncall/alerts/{alert['id']}/accept"
    assert (await api.post(url, headers=people["maria"])).status_code == 200

    again = await api.post(url, headers=people["maria"])
    assert again.status_code == 200 and again.json()["status"] == "accepted"
    assert (await api.post(url, headers=people["devon"])).status_code == 409


async def test_reassigning_an_accepted_case_ends_the_alert(api, people, database):
    """Maria accepted, then an admin gives the case to Devon: her Responding
    screen must not stay live."""
    await on_call(api, people, "maria")
    case = await urgent_case(api, people)
    await run_jobs(database)
    alert = await alert_for(api, people["maria"], case["id"])
    await api.post(f"/v1/oncall/alerts/{alert['id']}/accept", headers=people["maria"])

    await api.patch(f"/v1/cases/{case['id']}", headers=people["admin"], json={"assigned_worker_id": people["devon_id"]})

    after = await detail(api, people["maria"], alert["id"])
    assert after["status"] == "resolved"
    arrived = await api.post(f"/v1/oncall/alerts/{alert['id']}/arrived", headers=people["maria"])
    assert arrived.status_code in (403, 409)


async def test_members_get_403_and_stats_are_for_admins(api, people):
    case = await urgent_case(api, people)
    alert = await alert_for(api, people["admin"], case["id"])
    member = people["keisha"]
    for method, url in (
        ("get", "/v1/oncall/alerts"), ("get", f"/v1/oncall/alerts/{alert['id']}"),
        ("post", f"/v1/oncall/alerts/{alert['id']}/accept"), ("post", f"/v1/oncall/alerts/{alert['id']}/pass"),
        ("post", f"/v1/oncall/alerts/{alert['id']}/arrived"),
    ):
        assert (await getattr(api, method)(url, headers=member)).status_code == 403, url
    window = {"from": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
              "to": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    assert (await api.get("/v1/oncall/stats", headers=member, params=window)).status_code == 403
    assert (await api.get("/v1/oncall/stats", headers=people["maria"], params=window)).status_code == 403
    assert (await api.get(f"/v1/oncall/alerts/{uuid4()}", headers=people["maria"])).status_code == 404


async def test_stats(api, people, database):
    await on_call(api, people, "maria")
    taken, passed = await urgent_case(api, people), await urgent_case(api, people, title="Passed on")
    await run_jobs(database)
    taken_alert = await alert_for(api, people["maria"], taken["id"])
    passed_alert = await alert_for(api, people["maria"], passed["id"])
    await api.post(f"/v1/oncall/alerts/{taken_alert['id']}/accept", headers=people["maria"])
    await api.post(f"/v1/oncall/alerts/{taken_alert['id']}/arrived", headers=people["maria"])
    await api.post(f"/v1/oncall/alerts/{passed_alert['id']}/pass", headers=people["maria"], json={"reason": "too_far"})

    now = datetime.now(timezone.utc)
    stats = await api.get("/v1/oncall/stats", headers=people["admin"], params={
        "from": (now - timedelta(hours=1)).isoformat(), "to": (now + timedelta(minutes=1)).isoformat()})
    assert stats.status_code == 200
    body = stats.json()
    assert (body["alerts"], body["accepted"], body["unanswered"]) == (2, 1, 0)
    assert body["avg_seconds_to_accept"] >= 0 and body["avg_seconds_to_arrive"] >= 0
    assert body["passes_by_reason"] == {"busy": 0, "too_far": 1, "not_safe_alone": 0, "none": 0}
    empty = await api.get("/v1/oncall/stats", headers=people["admin"], params={
        "from": (now - timedelta(days=3)).isoformat(), "to": (now - timedelta(days=2)).isoformat()})
    assert empty.json() == {"alerts": 0, "accepted": 0, "unanswered": 0, "avg_seconds_to_accept": None,
                            "avg_seconds_to_arrive": None,
                            "passes_by_reason": {"busy": 0, "too_far": 0, "not_safe_alone": 0, "none": 0}}


# --- The ladder (app.oncall_ladder, and the skipping in app.oncall_offer_step) -----------


async def ladder(admin_conn, step: int, alert_id=None) -> list[str]:
    rows = await admin_conn.fetch("SELECT display_name FROM app.oncall_ladder($1, $2)", step, alert_id)
    return [r["display_name"] for r in rows]


async def shift(admin_conn, people, who: str, starts: timedelta, hours: float, rank: int = 1) -> None:
    await admin_conn.execute(
        "INSERT INTO app.oncall_shifts (user_id, starts_at, ends_at, rank, source) "
        "VALUES ($1, now() + $2::interval, now() + $2::interval + $3::interval, $4, 'schedule')",
        people[f"{who}_id"], starts, timedelta(hours=hours), rank)


async def test_the_ladder_primary_backup_then_fallback(api, people, admin_conn):
    await shift(admin_conn, people, "maria", timedelta(hours=-1), 3)
    await shift(admin_conn, people, "devon", timedelta(hours=-1), 3, rank=2)
    await admin_conn.execute(
        "INSERT INTO app.notification_preferences (user_id, urgent_when_off_call) VALUES ($1, true)",
        people["ana_id"])

    assert await ladder(admin_conn, 1) == ["Maria Santos"]
    assert await ladder(admin_conn, 2) == ["Devon Park"]
    # Admins, and workers who asked for urgent alerts off call; never members.
    assert await ladder(admin_conn, 3) == ["Ada Admin", "Ana Ruiz"]


async def test_without_a_backup_step_two_is_whoever_is_next(api, people, admin_conn):
    await shift(admin_conn, people, "maria", timedelta(hours=-1), 3)
    await shift(admin_conn, people, "ana", timedelta(hours=13), 3)  # too far off
    assert await ladder(admin_conn, 2) == []
    await shift(admin_conn, people, "devon", timedelta(hours=2), 3)
    assert await ladder(admin_conn, 2) == ["Devon Park"]


async def test_the_ladder_leaves_out_people_already_offered_and_skips_empty_steps(api, people, admin_conn, database):
    await shift(admin_conn, people, "devon", timedelta(hours=-1), 3, rank=2)
    case = await urgent_case(api, people)
    alert = await alert_for(api, people["admin"], case["id"])

    # Nobody is primary: step 1 is skipped and Devon (backup) is offered at once.
    await run_jobs(database)
    offered = await alert_for(api, people["devon"], case["id"])
    assert offered["step"] == 2 and offered["my_offer"]["step"] == 2
    assert await ladder(admin_conn, 2, alert["id"]) == []

    # Devon is an admin too now: the fallback doesn't offer it to him again.
    await admin_conn.execute("UPDATE app.users SET role = 'admin' WHERE id = $1", people["devon_id"])
    assert await ladder(admin_conn, 3, alert["id"]) == ["Ada Admin"]
