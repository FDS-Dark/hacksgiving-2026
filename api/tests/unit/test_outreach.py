"""Partners and consented sharing (services/partner.py), texts to
requesters (services/text.py, adapters/sms.py) and need versus coverage
(services/insights.py coverage_from)."""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import httpx
import pytest

from adapters.sms import FakeSms, SmsResult, TwilioSms, us_number
from databridge.case import CaseDatabridge
from databridge.partner import PartnerDatabridge
from databridge.text import TextDatabridge
from errors import ApiError
from models.insights import NeedMeasure
from models.partner import ConsentMethod, CreateShareRequest
from models.staff import Role, StaffMember
from models.text import PendingText
from services.insights import coverage_from
from services.partner import PartnerService
from services.text import CaseTexter, text_for
from settings import SmsConfig
from tests.unit.fakes import FakeFunctions

NOW = datetime.now(timezone.utc)
WORKER = StaffMember(id=uuid4(), display_name="Wes", role=Role.WORKER)


def case_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": uuid4(), "number": 1048, "kind": "request", "title": "Needs a bed tonight",
        "description": "Sleeping in her car with two kids.", "category": "homelessness", "priority": "high",
        "status": "new", "source": "public", "location": "N 27th St & W Center St", "latitude": None,
        "longitude": None, "contact_name": "Dana", "contact_phone": "414-555-0199", "contact_email": None,
        "requester_id": None, "assigned_worker_id": None, "assigned_worker_name": None, "created_by": None,
        "created_at": NOW, "updated_at": NOW, "resolved_at": None, "referral_count": 0, "last_activity_at": NOW,
        "contact_method": "text", "safe_to_contact": False,
    }
    return row | overrides


def partner_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": uuid4(), "name": "Harbor House", "description": "Family shelter", "categories": ["homelessness"],
        "contact_name": "Intake desk", "phone": "414-555-0100", "email": "intake@example.org", "website": None,
        "address": None, "languages": ["en", "es"], "accepts_shares": True, "notes": "", "active": True,
        "created_at": NOW, "updated_at": NOW,
    }
    return row | overrides


def share_row(case: dict[str, Any], partner: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    row = {
        "id": uuid4(), "case_id": case["id"], "partner_id": partner["id"], "partner_name": partner["name"],
        "partner_email": partner["email"], "partner_phone": partner["phone"], "shared_by": WORKER.id,
        "shared_by_name": "Wes", "purpose": "Intake for tonight", "include_contact": False,
        "include_location": False, "consent_method": "verbal", "consent_note": None, "created_at": NOW,
        "revoked_at": None, "revoked_by": None, "revoked_by_name": None,
    }
    return row | overrides


def update_row(case: dict[str, Any]) -> dict[str, Any]:
    return {"id": uuid4(), "case_id": case["id"], "case_number": case["number"], "case_title": case["title"],
            "author_id": WORKER.id, "author_name": "Wes", "update_type": "note", "visibility": "internal",
            "content": "x", "created_at": NOW}


def partners(db: FakeFunctions) -> PartnerService:
    return PartnerService(PartnerDatabridge(db), CaseDatabridge(db), db)


def share_body(partner: dict[str, Any], **overrides: Any) -> CreateShareRequest:
    fields = {"partner_id": partner["id"], "purpose": "Intake for tonight", "consent": True,
              "consent_method": ConsentMethod.VERBAL}
    return CreateShareRequest(**(fields | overrides))


# --- Sharing ---------------------------------------------------------------------


async def test_a_share_records_consent_in_the_history_and_sends_only_what_was_agreed():
    case, partner = case_row(), partner_row()
    db = FakeFunctions(case_get=[case], partner_get=[partner], case_share_create=[share_row(case, partner)],
                       case_add_update=[update_row(case)])

    shared = await partners(db).share(WORKER, case["id"], share_body(partner, consent_note="Agreed by phone"))

    (note,) = db.called("case_add_update")
    assert note["visibility"] == "internal"
    assert "Shared with Harbor House (the summary)" in note["content"] and "Agreed by phone" in note["content"]
    assert "Sleeping in her car" in shared.message
    assert "Dana" not in shared.message and "414-555-0199" not in shared.message
    assert "N 27th St" not in shared.message
    assert db.transactions == 1


async def test_name_phone_and_location_go_only_when_included_with_the_safety_warning():
    case, partner = case_row(), partner_row()
    row = share_row(case, partner, include_contact=True, include_location=True)
    db = FakeFunctions(case_get=[case], partner_get=[partner], case_share_create=[row],
                       case_add_update=[update_row(case)])

    shared = await partners(db).share(WORKER, case["id"], share_body(partner, include_contact=True,
                                                                     include_location=True))

    assert "Name: Dana" in shared.message and "Location: N 27th St & W Center St" in shared.message
    assert "not safe to leave a message" in shared.message


async def test_no_consent_no_share():
    partner = partner_row()
    with pytest.raises(ApiError) as error:
        await partners(FakeFunctions()).share(WORKER, uuid4(), share_body(partner, consent=False))
    assert error.value.code == "consent_required"


@pytest.mark.parametrize("partner", [partner_row(accepts_shares=False), partner_row(active=False)])
async def test_only_an_active_partner_that_accepts_shares(partner: dict[str, Any]):
    db = FakeFunctions(case_get=[case_row()], partner_get=[partner])
    with pytest.raises(ApiError) as error:
        await partners(db).share(WORKER, uuid4(), share_body(partner))
    assert error.value.code == "partner_not_accepting"


async def test_sharing_twice_with_the_same_partner_is_a_conflict():
    case, partner = case_row(), partner_row()
    db = FakeFunctions(case_get=[case], partner_get=[partner], case_share_create=[])
    with pytest.raises(ApiError) as error:
        await partners(db).share(WORKER, case["id"], share_body(partner))
    assert error.value.code == "already_shared"
    assert db.called("case_add_update") == []


# --- Texts -------------------------------------------------------------------------


def pending(**overrides: Any) -> dict[str, Any]:
    row = {"case_update_id": uuid4(), "case_id": uuid4(), "case_number": 1048, "update_type": "message",
           "case_status": "in_progress", "contact_phone": "(414) 555-0199", "last_sent_at": None}
    return row | overrides


def texter(rows: list[dict[str, Any]], sender: Any) -> tuple[CaseTexter, FakeFunctions]:
    db = FakeFunctions(case_text_pending=rows, case_text_record=[])
    return CaseTexter(TextDatabridge(db), sender, coalesce_minutes=30), db


@pytest.mark.parametrize(("text", "e164"), [
    ("(414) 555-0199", "+14145550199"), ("1-414-555-0199", "+14145550199"), ("414.555.0199", "+14145550199"),
    ("555-0199", None), ("+44 20 7946 0958", None), ("", None), (None, None),
])
def test_us_numbers_are_normalized(text: str | None, e164: str | None):
    assert us_number(text) == e164


async def test_a_text_is_generic_and_never_carries_the_update():
    sender = FakeSms()
    service, db = texter([pending()], sender)

    assert await service.sweep() == 1

    ((to, body),) = sender.sent
    assert to == "+14145550199"
    assert body.startswith("ComForce MKE: there's an update on request #1048.") and "STOP" in body
    (recorded,) = db.called("case_text_record")
    assert recorded["status"] == "sent" and recorded["provider_id"].startswith("fake-")


def test_each_kind_of_update_has_its_own_generic_text():
    assert "we got your request #1048" in text_for(PendingText(**pending(update_type="created")))
    assert "is marked done" in text_for(PendingText(**pending(update_type="status_change", case_status="resolved")))
    assert "there's an update" in text_for(PendingText(**pending(update_type="status_change")))


async def test_updates_close_together_are_coalesced_and_bad_numbers_skipped():
    case_id = uuid4()
    rows = [pending(case_id=case_id), pending(case_id=case_id), pending(contact_phone="call me"),
            pending(last_sent_at=NOW - timedelta(minutes=5))]
    sender = FakeSms()
    service, db = texter(rows, sender)

    assert await service.sweep(NOW) == 1

    reasons = [(r["status"], r["reason"]) for r in db.called("case_text_record")]
    assert reasons == [("sent", None), ("skipped", "coalesced"), ("skipped", "invalid_number"),
                       ("skipped", "coalesced")]


async def test_a_retryable_failure_is_left_for_next_round_and_an_opt_out_is_recorded():
    class Flaky:
        def __init__(self) -> None:
            self.results = [SmsResult(sent=False, reason="twilio_503", retry=True),
                            SmsResult(sent=False, reason="opted_out")]

        async def send(self, to: str, body: str) -> SmsResult:
            return self.results.pop(0)

        async def close(self) -> None:
            return None

    service, db = texter([pending(), pending()], Flaky())

    assert await service.sweep() == 0
    (recorded,) = db.called("case_text_record")
    assert (recorded["status"], recorded["reason"]) == ("failed", "opted_out")


async def test_twilio_sends_from_the_number_and_maps_opt_outs():
    config = SmsConfig(provider="twilio", twilio_account_sid="AC123", twilio_auth_token="t", from_number="+14145550100")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if b"To=%2B14145550111" in request.content:
            return httpx.Response(400, json={"code": 21610, "message": "unsubscribed"})
        return httpx.Response(201, json={"sid": "SM1"})

    sms = TwilioSms(config, httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert await sms.send("+14145550199", "hi") == SmsResult(sent=True, provider_id="SM1")
    assert await sms.send("+14145550111", "hi") == SmsResult(sent=False, reason="opted_out")
    assert seen[0].url.path == "/2010-04-01/Accounts/AC123/Messages.json"
    assert b"From=%2B14145550100" in seen[0].content


# --- Need versus coverage -----------------------------------------------------------------


def tract(geoid: str, need: float | None, cases: int) -> dict[str, Any]:
    return {"tract_geoid": geoid, "name": geoid[-3:], "latitude": 43.05, "longitude": -87.95, "need": need,
            "need_year": 2023, "cases": cases, "incidents": None}


def test_high_need_few_cases_is_a_gap_biggest_first():
    rows = [tract("001", 30.0, 0), tract("002", 28.0, 0), tract("003", 29.0, 6), tract("004", 10.0, 0),
            tract("005", 12.0, 2), tract("006", 11.0, 1), tract("007", 9.0, 0), tract("008", None, 0)]

    coverage = coverage_from(rows, NeedMeasure.HOUSING, 90)

    assert [t.tract_geoid for t in coverage.gaps] == ["001", "002"]
    assert coverage.category == "homelessness" and coverage.need_year == 2023
    assert coverage.summary.startswith("2 tracts have high housing insecurity")


def test_no_need_data_says_so():
    coverage = coverage_from([tract("001", None, 0)], NeedMeasure.FOOD, 30)
    assert coverage.gaps == [] and "No food insecurity data" in coverage.summary
