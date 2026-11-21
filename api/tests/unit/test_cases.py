"""Case workflow, staff permission and AI-assist rules, against in-memory
stored functions (tests/unit/fakes.py)."""

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from databridge.case import CaseDatabridge
from databridge.resource import ResourceDatabridge
from databridge.staff import StaffDatabridge
from databridge.task import TaskDatabridge
from dependencies import get_current_user, get_staff_service
from errors import ApiError
from main import app
from models.case import (
    AddCaseUpdateRequest,
    CaseDetail,
    SubmitRequest,
    UpdateCaseRequest,
    UpdateReferralRequest,
    Visibility,
)
from models.case_enums import CaseCategory
from models.staff import Role, StaffMember
from models.user import AppUser
from services.case import CaseService, Triage, title_from
from services.case_assist import CaseAssistant, case_context, rule_based_suggestions
from services.resource import ResourceService
from services.staff import StaffService
from services.task import TaskService
from tests.helpers import auth_header
from tests.unit.fakes import FakeFunctions

NOW = datetime.now(timezone.utc)


def case_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": uuid4(), "number": 1001, "kind": "request", "title": "Need a ride", "description": "To court",
        "category": "transportation", "priority": "medium", "status": "new", "source": "public",
        "location": None, "latitude": None, "longitude": None, "contact_name": "Casey",
        "contact_phone": "414-555-0199", "contact_email": None, "requester_id": uuid4(),
        "assigned_worker_id": None, "assigned_worker_name": None, "created_by": None,
        "created_at": NOW, "updated_at": NOW, "resolved_at": None, "referral_count": 0, "last_activity_at": NOW,
    }
    return row | overrides


def public_row(case: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "number", "title", "description", "category", "status", "location", "created_at",
            "updated_at", "resolved_at")
    return {k: case[k] for k in keys}


def update_row(case: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    return {
        "id": uuid4(), "case_id": case["id"], "case_number": case["number"], "case_title": case["title"],
        "author_id": None, "author_name": None, "update_type": "note", "visibility": "internal",
        "content": "x", "created_at": NOW,
    } | overrides


def resource_row(**overrides: Any) -> dict[str, Any]:
    return {
        "id": uuid4(), "name": "Ride to Care (Sample)", "category": "transportation", "description": "Rides",
        "address": None, "neighborhood": None, "phone": None, "website": None, "hours": None,
        "is_sample": True, "active": True, "created_at": NOW, "created_by": None, "updated_at": NOW,
    } | overrides


def staff_row(user_id: UUID, role: str) -> dict[str, Any]:
    return {"id": user_id, "display_name": "Wes", "role": role}


def service(db: FakeFunctions) -> CaseService:
    staff = StaffService(StaffDatabridge(db))
    return CaseService(
        CaseDatabridge(db), ResourceService(ResourceDatabridge(db)), staff, TaskService(TaskDatabridge(db), staff)
    )


def worker(user_id: UUID | None = None) -> StaffMember:
    return StaffMember(id=user_id or uuid4(), display_name="Wes", role=Role.WORKER)


# --- Public submissions ---------------------------------------------------------


async def test_a_submission_is_triaged_and_an_urgent_one_is_high_priority(sample_user: AppUser):
    case = case_row()
    db = FakeFunctions(request_create=[case], case_add_update=[update_row(case)],
                       request_get_for_user=[public_row(case)], task_create=[])

    async def triage(text: str) -> Triage:
        return Triage(category=CaseCategory.HOMELESSNESS, urgent=True, reason="Evicted today.")

    await service(db).submit_request(sample_user, SubmitRequest(description="We were evicted"), triage)

    (created,) = db.called("request_create")
    assert (created["category"], created["priority"]) == ("homelessness", "high")
    assert created["requester_id"] == sample_user.id and created["access_code_hash"] is None
    (note,) = db.called("case_add_update")
    assert note["visibility"] == "internal" and "Evicted today." in note["content"]


async def test_a_failing_triage_never_blocks_a_submission(sample_user: AppUser):
    case = case_row()
    db = FakeFunctions(request_create=[case], request_get_for_user=[public_row(case)], task_create=[])

    async def triage(text: str) -> Triage:
        raise TimeoutError

    request = await service(db).submit_request(sample_user, SubmitRequest(description="help"), triage)

    assert request.id == case["id"]
    assert db.called("request_create")[0]["category"] == "other"
    assert db.called("case_add_update") == []


async def test_a_chosen_category_skips_triage(sample_user: AppUser):
    case = case_row()
    db = FakeFunctions(request_create=[case], request_get_for_user=[public_row(case)], task_create=[])

    async def triage(text: str) -> Triage:
        raise AssertionError("not called")

    body = SubmitRequest(description="Need groceries", category=CaseCategory.MEAL_PROGRAMS)
    await service(db).submit_request(sample_user, body, triage)

    assert db.called("request_create")[0]["category"] == "meal_programs"


@pytest.mark.parametrize("field", ["priority", "status", "assigned_worker_id", "requester_id"])
def test_public_submissions_cannot_set_worker_fields(field: str):
    with pytest.raises(ValidationError):
        SubmitRequest.model_validate({"description": "help", field: "critical"})


def test_a_title_is_made_from_the_description():
    assert title_from("Need a ride to court\nTomorrow at 9") == "Need a ride to court"
    long = "word " * 40
    assert len(title_from(long)) <= 81 and title_from(long).endswith("…")


async def test_a_requester_never_sees_someone_elses_request(sample_user: AppUser):
    db = FakeFunctions(request_get_for_user=[])

    with pytest.raises(ApiError) as e:
        await service(db).my_request(sample_user, uuid4())

    assert e.value.status_code == 404


# --- Worker workflow -----------------------------------------------------------------


async def test_cases_are_only_assigned_to_staff():
    member_id = uuid4()
    db = FakeFunctions(staff_get=[staff_row(member_id, "member")])

    with pytest.raises(ApiError) as e:
        await service(db).update(worker(), uuid4(), UpdateCaseRequest(assigned_worker_id=member_id))

    assert e.value.code == "not_a_worker"
    assert db.called("case_update") == []


async def test_null_assignee_unassigns_and_a_missing_one_leaves_it():
    case = case_row()
    db = FakeFunctions(case_update=[case])
    cases = service(db)

    await cases.update(worker(), case["id"], UpdateCaseRequest.model_validate({"assigned_worker_id": None}))
    await cases.update(worker(), case["id"], UpdateCaseRequest(status="in_progress"))

    first, second = db.called("case_update")
    assert first["unassign"] is True and second["unassign"] is False


async def test_an_empty_update_is_rejected():
    with pytest.raises(ApiError) as e:
        await service(FakeFunctions()).update(worker(), uuid4(), UpdateCaseRequest())
    assert e.value.code == "no_changes"


async def test_a_public_update_is_a_message_and_an_internal_one_a_note():
    case = case_row()
    db = FakeFunctions(case_add_update=lambda p: [update_row(case, update_type=p["update_type"])])
    cases = service(db)

    await cases.add_update(worker(), case["id"], AddCaseUpdateRequest(content="Bed found", visibility="public"))
    await cases.add_update(worker(), case["id"], AddCaseUpdateRequest(content="Called back"))

    assert [c["update_type"] for c in db.called("case_add_update")] == ["message", "note"]


def test_a_referral_update_needs_a_status_or_an_outcome():
    with pytest.raises(ValidationError):
        UpdateReferralRequest()


# --- Staff ---------------------------------------------------------------------------


async def test_members_are_not_workers(sample_user: AppUser):
    db = FakeFunctions(staff_get=[staff_row(sample_user.id, "member")])

    with pytest.raises(ApiError) as e:
        await StaffService(StaffDatabridge(db)).require_worker(sample_user)

    assert e.value.status_code == 403


async def test_only_the_first_staff_member_can_bootstrap(sample_user: AppUser):
    db = FakeFunctions(staff_bootstrap=[])

    with pytest.raises(ApiError) as e:
        await StaffService(StaffDatabridge(db)).bootstrap(sample_user)

    assert e.value.status_code == 409


async def test_an_admin_cannot_demote_themselves():
    admin = StaffMember(id=uuid4(), display_name="A", role=Role.ADMIN)

    with pytest.raises(ApiError) as e:
        await StaffService(StaffDatabridge(FakeFunctions())).set_role(admin, admin.id, Role.WORKER)

    assert e.value.code == "cannot_demote_self"


async def test_the_case_api_is_staff_only(sample_user: AppUser):
    db = FakeFunctions(staff_get=[staff_row(sample_user.id, "member")])
    app.dependency_overrides.update({
        get_current_user: lambda: sample_user,
        get_staff_service: lambda: StaffService(StaffDatabridge(db)),
    })
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            responses = [
                await client.get("/v1/cases", headers=auth_header()),
                await client.get("/v1/cases/insights", headers=auth_header()),
                await client.patch(f"/v1/cases/{uuid4()}", headers=auth_header(), json={"status": "closed"}),
                await client.get("/v1/staff/users", headers=auth_header()),
            ]
    finally:
        app.dependency_overrides.clear()
    assert [r.status_code for r in responses] == [403, 403, 403, 403]


# --- AI assistance -------------------------------------------------------------------


def detail_with(case: dict[str, Any], updates: list[dict[str, Any]], referrals=()) -> CaseDetail:
    from models.case import Case, CaseUpdate, Referral

    return CaseDetail(case=Case(**case), updates=[CaseUpdate(**u) for u in updates],
                      referrals=[Referral(**r) for r in referrals], tasks=[])


def test_the_model_never_sees_contact_details_and_drafts_never_see_internal_notes():
    case = case_row(contact_name="Casey Jones", contact_phone="414-555-0199", contact_email="c@example.com")
    detail = detail_with(case, [
        update_row(case, content="Mom is staying with a cousin", visibility="internal"),
        update_row(case, content="We found a bed", visibility="public", update_type="message"),
    ])

    full, public = case_context(detail), case_context(detail, public_only=True)

    for text in (full, public):
        assert "Casey Jones" not in text and "414-555-0199" not in text and "c@example.com" not in text
    assert "cousin" in full and "cousin" not in public and "We found a bed" in public


def test_rule_based_suggestions_fit_the_category_and_skip_what_is_already_referred():
    case = case_row(category="transportation")
    ride, bus, food = (resource_row(name="Ride"), resource_row(name="Bus", is_sample=False),
                       resource_row(name="Food", category="meal_programs"))
    hub = resource_row(name="Hub", category="other")
    referral = {"id": uuid4(), "case_id": case["id"], "resource_id": ride["id"], "resource_name": "Ride",
                "resource_category": "transportation", "resource_phone": None, "resource_website": None,
                "resource_is_sample": True, "status": "suggested", "outcome": None, "created_by": None,
                "created_at": NOW, "updated_at": NOW}
    from models.resource import Resource

    result = rule_based_suggestions(detail_with(case, [], [referral]),
                                    [Resource(**r) for r in (ride, bus, food, hub)])

    assert result.method == "rules"
    assert [s.resource.name for s in result.suggestions] == ["Bus", "Hub"]


class FakeResponses:
    def __init__(self, output: Any) -> None:
        self.output = output

    async def parse(self, **_: Any) -> SimpleNamespace:
        return SimpleNamespace(output_parsed=self.output)


async def test_the_assistant_drops_resources_that_are_not_in_the_directory():
    from models.assist import PickedResource, RecommendationOutput
    from models.resource import Resource

    case = case_row()
    real = Resource(**resource_row())
    picks = RecommendationOutput(picks=[
        PickedResource(resource_id=str(uuid4()), reason="Made up"),
        PickedResource(resource_id=str(real.id), reason="Free rides to court"),
    ])

    assistant = CaseAssistant(FakeResponses(picks), "m")  # type: ignore[arg-type]
    result = await assistant.suggest_resources(detail_with(case, []), [real])

    assert [(s.resource.id, s.reason) for s in result.suggestions] == [(real.id, "Free rides to court")]


async def test_an_unavailable_model_is_a_503_not_a_500():
    case = case_row()
    assistant = CaseAssistant(FakeResponses(None), "m")  # type: ignore[arg-type]

    with pytest.raises(ApiError) as e:
        await assistant.summarize(detail_with(case, []))

    assert e.value.status_code == 503


def test_internal_visibility_is_the_default():
    assert AddCaseUpdateRequest(content="x").visibility == Visibility.INTERNAL
