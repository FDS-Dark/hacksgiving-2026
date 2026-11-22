"""Urgent escalation, against in-memory stored functions
(tests/unit/fakes.py): what pages, the stages' no-op rules and what they
queue, how the inbox shows urgent rows, and how case changes open or end an
alert. The ladder itself is SQL (app.oncall_ladder); its rules are tested
against Postgres in tests/integration/test_escalation_flows.py."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest

from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from databridge.oncall import OncallDatabridge, next_name
from errors import ApiError
from models.case import UpdateCaseRequest
from models.case_enums import CasePriority, pages_on_call
from models.job import Job
from models.notification import NotificationFacts, NotificationKind
from models.oncall import PassRequest
from models.staff import Role, StaffMember
from services.notification import NotificationService, render
from services.oncall_jobs import ESCALATE, OFFER, REMIND, EscalateStage, OfferStage, RemindStage
from tests.unit.fakes import FakeFunctions, queued_job
from tests.unit.test_cases import case_row, service as case_service
from tests.unit.test_oncall import service as oncall_service

NOW = datetime.now(timezone.utc)
ALERT, CASE = uuid4(), uuid4()
ME = StaffMember(id=uuid4(), display_name="Maria Santos", role=Role.WORKER)


# --- What pages -------------------------------------------------------------------


@pytest.mark.parametrize(("status", "priority", "assigned", "pages"), [
    ("new", "high", None, True),
    ("in_progress", "critical", None, True),
    ("awaiting_resources", "high", None, True),
    ("new", "medium", None, False),
    ("new", "low", None, False),
    ("new", "critical", uuid4(), False),
    ("resolved", "critical", None, False),
    ("closed", "high", None, False),
])
def test_an_open_unassigned_high_or_critical_case_pages(status: str, priority: str, assigned: UUID | None,
                                                        pages: bool):
    case = SimpleNamespace(status=status, priority=CasePriority(priority), assigned_worker_id=assigned)
    assert pages_on_call(case) is pages


def test_next_name_reads_naturally():
    assert next_name(None) is None and next_name([]) is None
    assert next_name(["Devon Park"]) == "Devon Park"
    assert next_name(["Ada Admin", "Ana Ruiz"]) == "Ada Admin and 1 other"
    assert next_name(["Ada Admin", "Ana Ruiz", "Bo"]) == "Ada Admin and 2 others"


# --- The stages ---------------------------------------------------------------------


def alert_row(**overrides: Any) -> dict[str, Any]:
    return {
        "id": ALERT, "case_id": CASE, "status": "offering", "step": 1, "step_expires_at": None,
        "reminders_sent": 0,
    } | overrides


def job(kind: str, **payload: Any) -> Job:
    return Job(
        id=uuid4(), kind=kind, payload={"alert_id": str(ALERT), **payload}, status="running", attempts=1,
        max_attempts=5, run_at=NOW, locked_by="test", locked_until=None, last_error=None, dedupe_key=None,
        created_at=NOW, updated_at=NOW, finished_at=None,
    )


def stages(db: FakeFunctions) -> tuple[OfferStage, EscalateStage, RemindStage]:
    alerts, jobs = OncallDatabridge(db), JobDatabridge(db)
    notifications = NotificationService(NotificationDatabridge(db), db)
    return (OfferStage(alerts, jobs, notifications, 300), EscalateStage(alerts, jobs),
            RemindStage(alerts, jobs, notifications, 600, 3))


def created(params: Any) -> list[dict[str, Any]]:
    return [{
        "id": uuid4(), "user_id": params["user_id"], "kind": params["kind"], "case_id": params["case_id"],
        "alert_id": params["alert_id"], "dedupe_key": params["dedupe_key"], "created_at": NOW, "read_at": None,
    }]


@pytest.mark.parametrize(("kind", "payload", "row"), [
    (OFFER, {"step": 1}, None),  # gone
    (OFFER, {"step": 1}, alert_row(status="accepted")),
    (OFFER, {"step": 1}, alert_row(step=2)),  # passed on already
    (ESCALATE, {"step": 1}, alert_row(status="accepted")),
    (ESCALATE, {"step": 1}, alert_row(status="cancelled")),
    (ESCALATE, {"step": 1}, alert_row(step=2)),
    (REMIND, {"n": 1}, alert_row(status="accepted")),
    (REMIND, {"n": 2}, alert_row(status="unanswered", reminders_sent=2)),  # already sent
    (REMIND, {"n": 4}, alert_row(status="unanswered", reminders_sent=3)),  # past the last
])
async def test_a_job_for_an_alert_that_moved_on_does_nothing(kind: str, payload: dict, row: dict | None):
    db = FakeFunctions(oncall_alert_get=[row] if row else [])
    stage = next(s for s in stages(db) if s.kind == kind)

    finish = await stage.run(job(kind, **payload))
    await finish(db)

    assert [name for name, _ in db.calls] == ["oncall_alert_get"]


async def test_an_offer_notifies_each_person_and_times_the_step():
    maria, devon, expires = uuid4(), uuid4(), NOW + timedelta(minutes=5)
    offers = [
        {"outcome": "offered", "case_id": CASE, "step": 2, "step_expires_at": expires, "offer_id": uuid4(),
         "user_id": who, "expires_at": expires} for who in (maria, devon)
    ]
    db = FakeFunctions(oncall_alert_get=[alert_row()], oncall_offer_step=offers, notification_create=created,
                       job_enqueue=queued_job)
    offer = stages(db)[0]

    await (await offer.run(job(OFFER, step=1)))(db)

    (step,) = db.called("oncall_offer_step")
    assert (step["step"], step["offer_seconds"]) == (1, 300)
    sent = db.called("notification_create")
    assert [n["user_id"] for n in sent] == [maria, devon]
    assert all(n["kind"] == NotificationKind.URGENT_OFFER and n["alert_id"] == ALERT and n["case_id"] == CASE
               and n["expires_at"] == expires for n in sent)
    assert [n["dedupe_key"] for n in sent] == [f"offer:{o['offer_id']}" for o in offers]
    escalate = [j for j in db.called("job_enqueue") if j["kind"] == ESCALATE]
    assert [(j["dedupe_key"], j["run_at"]) for j in escalate] == [(f"alert:{ALERT}:escalate:2", expires)]


async def test_nobody_left_on_the_ladder_starts_the_reminders():
    db = FakeFunctions(
        oncall_alert_get=[alert_row()], job_enqueue=queued_job,
        oncall_offer_step=[{"outcome": "unanswered", "case_id": CASE, "step": 1, "step_expires_at": None,
                            "offer_id": None, "user_id": None, "expires_at": None}])

    await (await stages(db)[0].run(job(OFFER, step=1)))(db)

    assert db.called("notification_create") == []
    assert [(j["kind"], j["dedupe_key"], j["run_at"]) for j in db.called("job_enqueue")
            if j["kind"].startswith("oncall.")] == [
        (REMIND, f"alert:{ALERT}:remind:1", None)]


@pytest.mark.parametrize(("outcome", "step", "queued"), [
    ("next", 2, (OFFER, f"alert:{ALERT}:offer:2")),
    ("unanswered", 3, (REMIND, f"alert:{ALERT}:remind:1")),
    ("noop", None, None),
])
async def test_escalating_queues_what_comes_next(outcome: str, step: int | None, queued: tuple | None):
    db = FakeFunctions(oncall_alert_get=[alert_row(step=1)], oncall_escalate=[{"outcome": outcome, "step": step}],
                       job_enqueue=queued_job)

    await (await stages(db)[1].run(job(ESCALATE, step=1)))(db)

    oncall_jobs = [(j["kind"], j["dedupe_key"]) for j in db.called("job_enqueue") if j["kind"].startswith("oncall.")]
    assert oncall_jobs == ([queued] if queued else [])


@pytest.mark.parametrize(("n", "next_key"), [(1, "remind:2"), (2, "remind:3"), (3, None)])
async def test_a_reminder_tells_every_admin_and_queues_the_next_up_to_three(n: int, next_key: str | None):
    admins = [uuid4(), uuid4()]
    db = FakeFunctions(
        oncall_alert_get=[alert_row(status="unanswered", reminders_sent=n - 1)],
        oncall_remind=[{"outcome": "reminded", "case_id": CASE, "user_id": a} for a in admins],
        notification_create=created, job_enqueue=queued_job)

    await (await stages(db)[2].run(job(REMIND, n=n)))(db)

    sent = db.called("notification_create")
    assert [(s["user_id"], s["kind"], s["dedupe_key"]) for s in sent] == [
        (a, NotificationKind.URGENT_UNANSWERED, f"unanswered:{ALERT}:{n}") for a in admins]
    queued = [j for j in db.called("job_enqueue") if j["kind"] == REMIND]
    assert [j["dedupe_key"] for j in queued] == ([f"alert:{ALERT}:{next_key}"] if next_key else [])
    if queued:
        assert queued[0]["run_at"] > NOW + timedelta(seconds=590)


# --- Accept and pass ------------------------------------------------------------------


def accept_row(outcome: str, **overrides: Any) -> dict[str, Any]:
    return {"outcome": outcome, "accepted_by_name": None, "case_id": CASE, "requester_id": None,
            "status_update_id": None} | overrides


async def test_a_second_accept_says_who_was_first():
    # oncall_alert_get finds nothing of mine: someone else accepted it.
    db = FakeFunctions(oncall_accept=[accept_row("already_accepted", accepted_by_name="Devon Park")],
                       oncall_alert_get=[])

    with pytest.raises(ApiError) as e:
        await oncall_service(db).accept(ME, ALERT)

    assert (e.value.status_code, e.value.code) == (409, "already_accepted")
    assert "Devon Park" in e.value.message


@pytest.mark.parametrize(("outcome", "status", "code"), [
    ("not_found", 404, "alert_not_found"), ("closed", 409, "alert_closed"),
])
async def test_accepting_a_missing_or_closed_alert(outcome: str, status: int, code: str):
    db = FakeFunctions(oncall_accept=[accept_row(outcome)])
    with pytest.raises(ApiError) as e:
        await oncall_service(db).accept(ME, ALERT)
    assert (e.value.status_code, e.value.code) == (status, code)


@pytest.mark.parametrize(("outcome", "code"), [
    ("not_offered", "not_offered"), ("closed", "alert_closed"), ("not_found", "alert_not_found"),
])
async def test_passing_without_an_open_offer(outcome: str, code: str):
    db = FakeFunctions(oncall_pass=[{"outcome": outcome, "step": 1}])
    with pytest.raises(ApiError) as e:
        await oncall_service(db).pass_offer(ME, ALERT, PassRequest())
    assert e.value.code == code


# --- The inbox ----------------------------------------------------------------------------


def facts(kind: NotificationKind, alert_id: UUID | None = ALERT) -> NotificationFacts:
    return NotificationFacts(id=uuid4(), kind=kind, case_id=CASE, case_number=1048, case_title="Fight on 27th",
                             reader_is_staff=True, alert_id=alert_id, created_at=NOW)


def test_urgent_rows_open_the_alert():
    offer = render(facts(NotificationKind.URGENT_OFFER))
    assert (offer.title, offer.body) == ("Urgent: Fight on 27th", "You're on call. Open it to accept or pass.")
    assert offer.route == f"/staff/alerts/{ALERT}" and offer.alert_id == ALERT

    waiting = render(facts(NotificationKind.URGENT_UNANSWERED))
    assert (waiting.title, waiting.body, waiting.route) == (
        "Nobody has accepted #1048", "Fight on 27th", f"/staff/alerts/{ALERT}")


# --- Case changes open or end the alert -------------------------------------------------


def worker() -> StaffMember:
    return StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)


@pytest.mark.parametrize(("changes", "after", "expected"), [
    ({"priority": "critical"}, {"priority": "critical"}, "open"),
    ({"assigned_worker_id": None}, {"priority": "high"}, "open"),
    ({"assigned_worker_id": "someone"}, {"priority": "high", "assigned_worker_id": "someone"}, "resolved"),
    ({"status": "closed"}, {"priority": "high", "status": "closed"}, "cancelled"),
    ({"priority": "medium"}, {"priority": "medium"}, "cancelled"),
    ({"title": "Renamed"}, {"priority": "high"}, None),  # not about paging: no alert call
])
async def test_a_case_change_opens_or_ends_its_alert(changes: dict, after: dict, expected: str | None):
    assignee = uuid4()
    for values in (changes, after):
        if values.get("assigned_worker_id") == "someone":
            values["assigned_worker_id"] = assignee
    updated = case_row(**after)
    db = FakeFunctions(
        case_update=[updated], case_list_updates_this_transaction=[], task_list=[],
        staff_get=[{"id": assignee, "display_name": "Devon", "role": "worker"}],
        oncall_alert_open=[alert_row(case_id=updated["id"])], oncall_resolve_for_case=[], job_enqueue=queued_job)

    await case_service(db).update(worker(), updated["id"], UpdateCaseRequest(**changes))

    opened, closed = db.called("oncall_alert_open"), db.called("oncall_resolve_for_case")
    if expected == "open":
        assert len(opened) == 1 and closed == []
        assert [j["dedupe_key"] for j in db.called("job_enqueue") if j["kind"] == OFFER] == [
            f"alert:{ALERT}:offer:1"]
    elif expected is None:
        assert opened == [] and closed == []
    else:
        assert opened == [] and [c["status"] for c in closed] == [expected]
    assert db.transactions == 1
