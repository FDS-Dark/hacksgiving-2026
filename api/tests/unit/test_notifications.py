"""The inbox: how each kind renders, what a resident's item may show, who
is notified (never the person who acted), task reminders, preferences, and
a worker that starts without an OpenAI key. Against in-memory stored
functions (tests/unit/fakes.py)."""

from collections.abc import Mapping
from datetime import datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import pytest

from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from databridge.task import TaskDatabridge
from models.case import AddCaseUpdateRequest, ReplyRequest, UpdateCaseRequest, UpdateReferralRequest
from models.job import Job
from models.notification import (
    NotificationFacts,
    NotificationKind,
    NotificationPreferences,
    UpdateNotificationPreferences,
)
from models.task import Task
from models.user import AppUser
from services.notification import NotificationService, render
from services.notification_jobs import TASK_REMIND, TaskRemindStage, enqueue_task_reminder
from tests.unit.fakes import FakeFunctions, queued_job
from tests.unit.test_cases import NOW, case_row, public_row, update_row, worker
from tests.unit.test_get_help import service, task_row


def facts(kind: str, **overrides: Any) -> NotificationFacts:
    row = {
        "id": uuid4(), "kind": kind, "case_id": uuid4(), "case_number": 1044, "case_title": "Ride to dialysis",
        "case_status": "in_progress", "task_id": None, "task_title": None, "reader_is_staff": True,
        "update_type": None, "update_content": None, "actor_name": None, "contact_name": None,
        "referral_status": None, "resource_name": None, "created_at": NOW, "read_at": None,
    }
    return NotificationFacts(**(row | overrides))


def created(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    """An app.notification_create handler: the row it was asked for."""
    keys = ("user_id", "kind", "dedupe_key", "case_id", "case_update_id", "task_id", "referral_id", "actor_id")
    return [{"id": uuid4(), "created_at": NOW, "read_at": None} | {k: params[k] for k in keys}]


# --- Rendering ---------------------------------------------------------------------


def test_an_assignment_names_who_assigned_it():
    item = render(facts("assignment", actor_name="Devon"))
    assert (item.title, item.body, item.route) == (
        "Devon assigned you #1044", "Ride to dialysis", f"/staff/cases/{item.case_id}")
    assert render(facts("assignment")).title == "Someone assigned you #1044"


def test_a_reply_quotes_the_first_120_characters():
    item = render(facts("reply", contact_name="Keisha", update_content="Yes please " * 30))
    assert item.title == "Keisha replied on #1044"
    assert item.body.startswith("“Yes please") and item.body.endswith("…”") and len(item.body) <= 124
    assert render(facts("reply", update_content="ok")).title == "The requester replied on #1044"


def test_task_due_and_referral_updates():
    task = render(facts("task_due", task_id=uuid4(), task_title="Call the requester"))
    assert (task.title, task.body) == ("Task due soon", "Call the requester · #1044")
    assert task.task_id is not None
    referral = render(facts("referral_update", referral_status="accepted", resource_name="Ride to Care"))
    assert (referral.title, referral.body) == ("Referral accepted", "Ride to Care · #1044")


def test_a_resident_hears_of_a_message_or_a_status_change_on_their_request():
    message = render(facts("request_update", reader_is_staff=False, update_type="message",
                           update_content="We found you a bed tonight."))
    assert (message.title, message.body) == ("ComForce replied", "We found you a bed tonight.")
    assert message.route == f"/help/request/{message.case_id}"
    status = render(facts("request_update", reader_is_staff=False, update_type="status_change",
                          update_content="Status changed from new to in progress."))
    assert (status.title, status.body) == ("Your request was updated", "Status: In progress")


def test_a_residents_item_never_shows_staff_names_or_contact_details():
    """notification_list already leaves them out for a resident; the
    renderer doesn't use them for request_update either."""
    item = render(facts("request_update", reader_is_staff=False, update_type="message", update_content="Hi",
                        actor_name="Maria Santos", contact_name="Keisha Brown"))
    shown = item.model_dump_json()
    assert "Maria" not in shown and "Keisha" not in shown


# --- notify -------------------------------------------------------------------------


async def test_notify_skips_the_actor_and_nobody():
    db = FakeFunctions(notification_create=created, job_enqueue=queued_job)
    notifications = NotificationService(NotificationDatabridge(db), db)
    me = uuid4()

    assert not await notifications.notify(db, user_id=me, kind=NotificationKind.ASSIGNMENT, dedupe_key="k",
                                          actor_id=me)
    assert not await notifications.notify(db, user_id=None, kind=NotificationKind.REPLY, dedupe_key="k",
                                          actor_id=None)
    assert await notifications.notify(db, user_id=uuid4(), kind=NotificationKind.REPLY, dedupe_key="k",
                                      actor_id=None)
    assert len(db.called("notification_create")) == 1
    # Its push job, in the same transaction.
    (job,) = db.called("job_enqueue")
    assert job["kind"] == "notification.push" and job["dedupe_key"].startswith("notification:")


# --- The hooks in CaseService ----------------------------------------------------------


async def test_an_assignment_by_someone_else_notifies_the_new_assignee():
    actor, assignee = worker(), uuid4()
    case = case_row(assigned_worker_id=assignee)
    entry = update_row(case, update_type="assignment", author_id=actor.id)
    db = FakeFunctions(staff_get=[{"id": assignee, "display_name": "Ana", "role": "worker"}], case_update=[case],
                       case_list_updates_this_transaction=[entry], notification_create=created, task_list=[],
                       job_enqueue=queued_job)

    await service(db).update(actor, case["id"], UpdateCaseRequest(assigned_worker_id=assignee))

    (sent,) = db.called("notification_create")
    assert (sent["user_id"], sent["kind"], sent["dedupe_key"], sent["actor_id"]) == (
        assignee, "assignment", f"assignment:{entry['id']}", actor.id)
    assert db.transactions == 1


async def test_assigning_yourself_notifies_nobody():
    me = worker()
    case = case_row(assigned_worker_id=me.id, requester_id=None)
    entry = update_row(case, update_type="assignment", author_id=me.id)
    db = FakeFunctions(staff_get=[{"id": me.id, "display_name": "Wes", "role": "worker"}], case_update=[case],
                       case_list_updates_this_transaction=[entry], notification_create=created, task_list=[],
                       job_enqueue=queued_job)

    await service(db).update(me, case["id"], UpdateCaseRequest(assigned_worker_id=me.id))

    assert db.called("notification_create") == []


async def test_a_status_change_notifies_the_requester_and_other_fields_look_for_nothing():
    case = case_row()
    entry = update_row(case, update_type="status_change", visibility="public")
    db = FakeFunctions(case_update=[case], case_list_updates_this_transaction=[entry], notification_create=created,
                       job_enqueue=queued_job)
    cases = service(db)

    await cases.update(worker(), case["id"], UpdateCaseRequest(status="in_progress"))
    await cases.update(worker(), case["id"], UpdateCaseRequest(priority="high"))

    (sent,) = db.called("notification_create")
    assert (sent["user_id"], sent["kind"], sent["dedupe_key"]) == (
        case["requester_id"], "request_update", f"update:{entry['id']}")
    assert len(db.called("case_list_updates_this_transaction")) == 1


async def test_a_public_message_notifies_the_requester_and_a_note_does_not():
    case = case_row()
    db = FakeFunctions(case_add_update=lambda p: [update_row(case, visibility=p["visibility"])], case_get=[case],
                       notification_create=created, job_enqueue=queued_job)
    cases = service(db)

    public = AddCaseUpdateRequest(content="Bed found", visibility="public")
    message = await cases.add_update(worker(), case["id"], public)
    await cases.add_update(worker(), case["id"], AddCaseUpdateRequest(content="Internal"))

    (sent,) = db.called("notification_create")
    assert (sent["user_id"], sent["dedupe_key"]) == (case["requester_id"], f"update:{message.id}")


async def test_a_reply_notifies_the_assignee(sample_user: AppUser):
    assignee = uuid4()
    case = case_row(requester_id=sample_user.id, assigned_worker_id=assignee)
    reply = {"id": uuid4(), "update_type": "reply", "content": "Yes", "created_at": NOW}
    db = FakeFunctions(request_get_for_user=[public_row(case)], request_add_reply=[reply], case_get=[case],
                       notification_create=created, job_enqueue=queued_job)

    await service(db).reply(sample_user, case["id"], ReplyRequest(content="Yes"))

    (sent,) = db.called("notification_create")
    assert (sent["user_id"], sent["kind"], sent["dedupe_key"], sent["actor_id"]) == (
        assignee, "reply", f"reply:{reply['id']}", sample_user.id)


def referral_row(case: dict[str, Any], referral_id: UUID, status: str) -> dict[str, Any]:
    return {
        "id": referral_id, "case_id": case["id"], "resource_id": uuid4(), "resource_name": "Ride to Care",
        "resource_category": "transportation", "resource_phone": None, "resource_website": None,
        "resource_is_sample": True, "status": status, "outcome": None, "created_by": None,
        "created_at": NOW, "updated_at": NOW,
    }


async def test_a_referral_status_change_notifies_the_assignee_once_per_change():
    assignee, referral_id = uuid4(), uuid4()
    case = case_row(assigned_worker_id=assignee)
    entry = update_row(case, update_type="referral")
    db = FakeFunctions(referral_list=[referral_row(case, referral_id, "shared")],
                       referral_update=[referral_row(case, referral_id, "accepted")], case_get=[case],
                       case_list_updates_this_transaction=[entry], notification_create=created, task_list=[],
                       job_enqueue=queued_job)
    cases = service(db)

    await cases.update_referral(worker(), case["id"], referral_id, UpdateReferralRequest(status="accepted"))
    await cases.update_referral(worker(), case["id"], referral_id, UpdateReferralRequest(outcome="Booked"))

    (sent,) = db.called("notification_create")
    assert (sent["user_id"], sent["kind"], sent["dedupe_key"], sent["referral_id"]) == (
        assignee, "referral_update", f"referral:{entry['id']}", referral_id)


# --- task.remind --------------------------------------------------------------------


def task(**overrides: Any) -> Task:
    return Task(**task_row(case_row(), **overrides))


async def test_a_reminder_is_queued_30_minutes_before_the_due_time():
    now = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)
    db = FakeFunctions(job_enqueue=queued_job)
    jobs = JobDatabridge(db)

    soon = task(due_at=now + timedelta(hours=2))
    assert await enqueue_task_reminder(jobs, soon, now=now)
    assert await enqueue_task_reminder(jobs, task(due_at=now + timedelta(minutes=10)), now=now)
    assert await enqueue_task_reminder(jobs, task(due_at=now - timedelta(minutes=20)), now=now)
    assert not await enqueue_task_reminder(jobs, task(due_at=now - timedelta(minutes=31)), now=now)
    assert not await enqueue_task_reminder(jobs, task(due_at=None), now=now)

    first, second, third = db.called("job_enqueue")
    assert first["kind"] == TASK_REMIND and first["run_at"] == now + timedelta(minutes=90)
    assert first["dedupe_key"] == f"task:{soon.id}:remind:2026-11-21T14:00:00+00:00"
    assert second["run_at"] is None and third["run_at"] is None  # at once


def remind_job(t: Task, due_at: datetime | None = None) -> Job:
    return Job(**queued_job({"kind": TASK_REMIND, "max_attempts": 5, "run_at": None, "dedupe_key": None})[0]
               | {"payload": {"task_id": str(t.id), "due_at": (due_at or t.due_at or NOW).isoformat()}})


def remind_stage(db: FakeFunctions) -> TaskRemindStage:
    return TaskRemindStage(TaskDatabridge(db), NotificationService(NotificationDatabridge(db), db))


@pytest.mark.parametrize("overrides", [
    {"status": "done", "assigned_worker_id": uuid4()},
    {"assigned_worker_id": None},
    {"due_at": NOW + timedelta(hours=3), "assigned_worker_id": uuid4()},
])
async def test_a_reminder_does_nothing_for_a_done_moved_or_ownerless_task(overrides: dict[str, Any]):
    t = task(**overrides)
    db = FakeFunctions(task_get=[t.model_dump()], notification_create=created, job_enqueue=queued_job)

    finish = await remind_stage(db).run(remind_job(t, due_at=NOW))
    await finish(db)

    assert db.called("notification_create") == []


async def test_a_reminder_for_a_missing_task_does_nothing():
    db = FakeFunctions(task_get=[])
    await (await remind_stage(db).run(remind_job(task())))(db)
    assert [name for name, _ in db.calls] == ["task_get"]


async def test_a_reminder_notifies_the_tasks_owner_in_finish():
    owner = uuid4()
    t = task(assigned_worker_id=owner, due_at=datetime(2026, 11, 21, 14, 0, tzinfo=timezone.utc))
    db = FakeFunctions(task_get=[t.model_dump()], notification_create=created, job_enqueue=queued_job)
    # The payload's offset differs; it is the same instant.
    other_zone = timezone(timedelta(hours=-6))

    finish = await remind_stage(db).run(remind_job(t, due_at=t.due_at.astimezone(other_zone)))  # type: ignore
    assert db.called("notification_create") == []  # run only reads
    await finish(db)

    (sent,) = db.called("notification_create")
    assert (sent["user_id"], sent["kind"], sent["task_id"], sent["dedupe_key"]) == (
        owner, "task_due", t.id, f"task_due:{t.id}:2026-11-21T14:00:00+00:00")


# --- Preferences ----------------------------------------------------------------------


def saved(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [dict(params) | {"updated_at": NOW}]


async def test_a_preferences_patch_changes_only_what_was_sent(sample_user: AppUser):
    stored = {"user_id": sample_user.id, "push_enabled": False, "muted_kinds": ["reply"],
              "quiet_start": time(21, 0), "quiet_end": time(7, 0), "urgent_when_off_call": False,
              "updated_at": NOW}
    db = FakeFunctions(notification_preferences_get=[stored], notification_preferences_save=saved)
    notifications = NotificationService(NotificationDatabridge(db), db)

    prefs = await notifications.update_preferences(
        sample_user, UpdateNotificationPreferences.model_validate({"urgent_when_off_call": True, "quiet_start": None})
    )

    assert (prefs.push_enabled, prefs.muted_kinds, prefs.quiet_start, prefs.quiet_end, prefs.urgent_when_off_call) \
        == (False, [NotificationKind.REPLY], None, time(7, 0), True)


def test_quiet_hours_are_sent_as_hours_and_minutes():
    prefs = NotificationPreferences(quiet_start=time(21, 0), quiet_end=None)
    assert prefs.model_dump(mode="json")["quiet_start"] == "21:00"
    assert UpdateNotificationPreferences.model_validate({"quiet_end": "07:00"}).quiet_end == time(7, 0)


# --- The worker ---------------------------------------------------------------------------


def test_the_worker_runs_task_reminders_without_an_openai_key():
    from worker.__main__ import build_stages

    stages, sweeper = build_stages(FakeFunctions(), None, None)  # type: ignore[arg-type]

    kinds = [s.kind for s in stages]
    # Push runs without a provider too (its jobs finish without sending).
    assert {TASK_REMIND, "notification.push"} <= set(kinds) and sweeper is None
    assert not [k for k in kinds if k.startswith("record.")]


def test_with_a_key_the_worker_also_runs_phantoms_stages():
    from worker.__main__ import build_stages

    stages, _ = build_stages(FakeFunctions(), "sk-test", None)  # type: ignore[arg-type]

    kinds = [s.kind for s in stages]
    assert {TASK_REMIND, "notification.push", "record.redact", "record.extract"} <= set(kinds)
    assert "record.transcribe" not in kinds  # no object storage
