"""A resident asks for help: safe-contact rules, requests without an account
(access codes, rate limits), replies, and the tasks each case gets."""

from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from databridge.case import CaseDatabridge
from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from databridge.oncall import OncallDatabridge
from databridge.resource import ResourceDatabridge
from databridge.staff import StaffDatabridge
from databridge.task import TaskDatabridge
from dependencies import get_case_service, get_triager
from errors import ApiError
from main import app
from models.case import Case, ContactMethod, ReplyRequest, SubmitRequest
from models.case_enums import CaseCategory
from models.staff import Role, StaffMember
from models.task import CreateTaskRequest, UpdateTaskRequest
from models.user import AppUser
from services import access_code
from services.notification import NotificationService
from services.oncall import OncallService
from services.case import CaseService
from services.rate_limit import RateLimit, anonymous_submissions, code_lookups
from services.resource import ResourceService
from services.staff import StaffService
from services.task import TaskService, plan_tasks
from tests.unit.fakes import FakeFunctions, queued_job
from tests.unit.test_cases import NOW, case_row, public_row


def service(db: FakeFunctions) -> CaseService:
    staff = StaffService(StaffDatabridge(db))
    tasks = TaskService(TaskDatabridge(db), staff, JobDatabridge(db), db)
    notifications = NotificationService(NotificationDatabridge(db), db)
    # No alert to open or close unless a test says otherwise.
    db.handlers.setdefault("oncall_alert_open", [])
    db.handlers.setdefault("oncall_resolve_for_case", [])
    oncall = OncallService(
        OncallDatabridge(db), db, ZoneInfo("America/Chicago"), jobs=JobDatabridge(db), notifications=notifications,
        tasks=tasks,
    )
    return CaseService(
        CaseDatabridge(db), ResourceService(ResourceDatabridge(db)), staff, tasks, notifications, db, oncall
    )


def task_row(case: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    return {
        "id": uuid4(), "case_id": case["id"], "case_number": case["number"], "case_title": case["title"],
        "case_category": case["category"], "case_priority": case["priority"], "title": "Call the requester",
        "detail": "", "status": "open", "assigned_worker_id": None, "assigned_worker_name": None,
        "due_at": NOW, "created_by": None, "created_at": NOW, "completed_at": None, "completed_by": None,
    } | overrides


def echo_task(case: dict[str, Any]):
    return lambda p: [task_row(case, title=p["title"], detail=p["detail"], due_at=p["due_at"])]


# --- The form ---------------------------------------------------------------------


@pytest.mark.parametrize("method", ["call", "text"])
def test_calling_or_texting_needs_a_phone_number(method: str):
    with pytest.raises(ValidationError):
        SubmitRequest(description="help", contact_method=method)
    SubmitRequest(description="help", contact_method=method, contact_phone="414-555-0142")


def test_no_contact_needs_no_phone():
    SubmitRequest(description="help", contact_method="none")


async def test_dont_contact_me_keeps_no_number(sample_user: AppUser):
    case = case_row()
    db = FakeFunctions(request_create=[case], request_get_for_user=[public_row(case)], task_create=[])
    body = SubmitRequest(description="help", contact_method="none", contact_phone="414-555-0142", safe_to_contact=True)

    await service(db).submit_request(sample_user, body, None)

    (created,) = db.called("request_create")
    assert created["contact_phone"] is None and created["safe_to_contact"] is None
    assert created["contact_method"] == ContactMethod.NONE


# --- Without an account -----------------------------------------------------------


def test_access_codes_are_readable_and_forgiving():
    code = access_code.new_code()
    assert len(code) == 9 and code[4] == "-"
    assert not set(code.replace("-", "")) & set("01ILO")
    assert access_code.hash_code(code) == access_code.hash_code(code.lower().replace("-", " "))
    assert access_code.hash_code("K7QM-4XPA") != access_code.hash_code("K7QM-4XPB")


async def test_an_anonymous_request_comes_back_with_a_code_that_opens_it():
    case = case_row(requester_id=None)
    db = FakeFunctions(
        request_create=[case],
        request_get_by_code=lambda p: [public_row(case)] if p["number"] == case["number"] else [],
        request_list_public_updates=[],
        case_get=[case],
        task_create=[],
    )
    cases = service(db)

    receipt = await cases.submit_anonymous_request(SubmitRequest(description="We were evicted"), None)

    (created,) = db.called("request_create")
    assert created["requester_id"] is None
    assert created["access_code_hash"] == access_code.hash_code(receipt.access_code)
    detail = await cases.request_by_code(case["number"], receipt.access_code)
    assert detail.request.id == case["id"]


async def test_a_wrong_code_or_number_is_not_found():
    db = FakeFunctions(request_get_by_code=[])

    for number, code in ((1001, "AAAA-BBBB"), (1001, "  ")):
        with pytest.raises(ApiError) as e:
            await service(db).request_by_code(number, code)
        assert e.value.status_code == 404


async def test_a_reply_needs_access_to_the_request(sample_user: AppUser):
    db = FakeFunctions(request_get_for_user=[])

    with pytest.raises(ApiError) as e:
        await service(db).reply(sample_user, uuid4(), ReplyRequest(content="Please call me"))

    assert e.value.status_code == 404
    assert db.called("request_add_reply") == []


async def test_a_reply_by_code_is_anonymous():
    case = case_row(requester_id=None)
    reply = {"id": uuid4(), "update_type": "reply", "content": "Yes", "created_at": NOW}
    db = FakeFunctions(request_get_by_code=[public_row(case)], request_add_reply=[reply], case_get=[case])

    await service(db).reply_by_code(case["number"], "K7QM-4XPA", ReplyRequest(content="Yes"))

    (call,) = db.called("request_add_reply")
    assert call["author_id"] is None and call["case_id"] == case["id"]


def test_the_rate_limit_counts_per_client_and_forgets_old_calls():
    limit = RateLimit("test", limit=2, window_seconds=60)
    limit.check("a", now=0)
    limit.check("a", now=1)
    limit.check("b", now=1)
    with pytest.raises(ApiError) as e:
        limit.check("a", now=2)
    assert e.value.status_code == 429
    limit.check("a", now=61)


async def test_anonymous_routes_need_no_token_and_are_rate_limited():
    case = case_row(requester_id=None)
    db = FakeFunctions(request_create=[case], request_get_by_code=[public_row(case)], task_create=[])
    app.dependency_overrides[get_case_service] = lambda: service(db)
    app.dependency_overrides[get_triager] = lambda: None
    anonymous_submissions.reset()
    code_lookups.reset()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            statuses = [
                (await client.post("/v1/public/requests", json={"description": "help"})).status_code
                for _ in range(anonymous_submissions.limit + 1)
            ]
            missing_code = await client.get(f"/v1/public/requests/{case['number']}")
    finally:
        app.dependency_overrides.clear()
        anonymous_submissions.reset()
        code_lookups.reset()

    assert statuses == [201] * anonymous_submissions.limit + [429]
    assert missing_code.status_code == 422


# --- Tasks ------------------------------------------------------------------------


def case_model(**overrides: Any) -> Case:
    return Case(**case_row(**overrides))


def test_every_case_starts_with_reaching_the_person_then_its_follow_ups():
    tasks = plan_tasks(case_model(category="homelessness", contact_method="call", safe_to_contact=True))

    assert [t.title for t in tasks] == [
        "Call the requester", "Find a shelter bed for tonight", "Offer a ride to the shelter",
    ]
    assert tasks[0].due_in.total_seconds() == 3600


def test_urgent_cases_are_due_sooner():
    (first, *_) = plan_tasks(case_model(priority="high"))
    (incident, *_) = plan_tasks(case_model(category="incident_deescalation", priority="low"))
    assert first.due_in.total_seconds() == incident.due_in.total_seconds() == 15 * 60


def test_the_contact_task_respects_how_they_asked_to_be_reached():
    unsafe = plan_tasks(case_model(contact_method="call", safe_to_contact=False))[0]
    text = plan_tasks(case_model(contact_method="text", safe_to_contact=True))[0]
    none = plan_tasks(case_model(contact_method="none"))[0]

    assert "voicemail" in unsafe.detail
    assert text.title == "Text the requester"
    assert "no contact" in none.title


def test_the_contact_task_carries_the_phone_number():
    """Regression (cognitive-load review S2): a staff case's callback task
    must show the number, and must not claim the person said it's safe."""
    staff_case = plan_tasks(case_model(source="worker", contact_method=None, safe_to_contact=None,
                                       contact_phone="414-555-0199"))[0]
    no_phone = plan_tasks(case_model(source="worker", contact_method=None, safe_to_contact=None,
                                     contact_phone=None))[0]

    assert staff_case.title == "Call the requester"
    assert "414-555-0199" in staff_case.detail and "said it's safe" not in staff_case.detail
    assert "No phone number" in no_phone.detail


@pytest.mark.parametrize("category", list(CaseCategory))
def test_every_category_has_follow_ups(category: CaseCategory):
    assert len(plan_tasks(case_model(category=category))) >= 2


async def test_a_submission_generates_tasks_due_from_when_it_came_in(sample_user: AppUser):
    case = case_row(category="meal_programs")
    db = FakeFunctions(request_create=[case], request_get_for_user=[public_row(case)], task_create=echo_task(case),
                       job_enqueue=queued_job)

    await service(db).submit_request(sample_user, SubmitRequest(description="No food"), None)

    created = db.called("task_create")
    assert [t["title"] for t in created] == ["Call the requester", "Connect them with a pantry or meal program"]
    assert all(t["case_id"] == case["id"] and t["created_by"] is None for t in created)
    assert created[0]["due_at"] > NOW


async def test_failing_task_generation_never_loses_the_request(sample_user: AppUser):
    case = case_row()

    def broken(_: Any) -> list[Any]:
        raise RuntimeError("database hiccup")

    db = FakeFunctions(request_create=[case], request_get_for_user=[public_row(case)], task_create=broken)

    request = await service(db).submit_request(sample_user, SubmitRequest(description="help"), None)

    assert request.id == case["id"]


async def test_tasks_are_only_handed_to_staff():
    member_id = uuid4()
    db = FakeFunctions(staff_get=[{"id": member_id, "display_name": "Mo", "role": "member"}])
    tasks = task_service(db)
    worker = StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)

    with pytest.raises(ApiError) as e:
        await tasks.update(worker, uuid4(), UpdateTaskRequest(assigned_worker_id=member_id))

    assert e.value.code == "not_a_worker"
    assert db.called("task_update") == []


def task_service(db: FakeFunctions) -> TaskService:
    return TaskService(TaskDatabridge(db), StaffService(StaffDatabridge(db)), JobDatabridge(db), db)


async def test_a_worker_adds_a_task_to_a_case():
    case = case_row()
    assignee = uuid4()
    db = FakeFunctions(
        staff_get=[{"id": assignee, "display_name": "Ana", "role": "worker"}],
        task_add=lambda p: [task_row(case, title=p["title"], due_at=p["due_at"],
                                     assigned_worker_id=p["assigned_worker_id"], created_by=p["actor_id"])],
        job_enqueue=queued_job,
    )
    worker = StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)

    task = await task_service(db).add(
        worker, case["id"], CreateTaskRequest(title="  Drop off groceries ", due_at=NOW, assigned_worker_id=assignee)
    )

    (sent,) = db.called("task_add")
    assert sent == {"case_id": case["id"], "title": "Drop off groceries", "due_at": NOW,
                    "assigned_worker_id": assignee, "actor_id": worker.id}
    assert (task.title, task.assigned_worker_id, task.created_by) == ("Drop off groceries", assignee, worker.id)


async def test_a_task_without_an_assignee_needs_no_staff_lookup():
    case = case_row()
    db = FakeFunctions(task_add=lambda p: [task_row(case, title=p["title"], due_at=p["due_at"])])
    worker = StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)

    task = await task_service(db).add(worker, case["id"], CreateTaskRequest(title="Call back"))

    assert task.due_at is None and db.called("task_add")[0]["assigned_worker_id"] is None
    assert db.called("staff_get") == []


async def test_a_task_on_a_missing_case_is_a_404():
    db = FakeFunctions(task_add=[])
    worker = StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)

    with pytest.raises(ApiError) as e:
        await task_service(db).add(worker, uuid4(), CreateTaskRequest(title="Call back"))

    assert (e.value.status_code, e.value.code) == (404, "case_not_found")


async def test_an_added_task_is_only_handed_to_staff():
    member_id = uuid4()
    db = FakeFunctions(staff_get=[{"id": member_id, "display_name": "Mo", "role": "member"}])
    worker = StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)

    with pytest.raises(ApiError) as e:
        await task_service(db).add(worker, uuid4(), CreateTaskRequest(title="Call back", assigned_worker_id=member_id))

    assert e.value.code == "not_a_worker"
    assert db.called("task_add") == []


@pytest.mark.parametrize("title", ["", "   ", "x" * 161])
def test_a_task_needs_a_title_that_fits(title: str):
    with pytest.raises(ValidationError):
        CreateTaskRequest(title=title)
