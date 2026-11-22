"""Team chat (services/chat.py, its inbox rows and pushes), requests for
help to partners (services/partner.py), who delivered a referral's help
(models/case.py) and "Export my records" (services/export.py), against
in-memory stored functions (tests/unit/fakes.py)."""

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from adapters.sms import FakeSms, SmsResult, sms_configured
from databridge.case import CaseDatabridge
from databridge.chat import ChatDatabridge
from databridge.export import ExportDatabridge
from databridge.notification import NotificationDatabridge
from databridge.partner import PartnerDatabridge
from errors import ApiError
from models.case import UpdateReferralRequest
from models.case_enums import CaseCategory
from models.chat import SendChatMessageRequest
from models.notification import NotificationFacts, NotificationKind
from models.partner import CreatePartnerRequest
from models.push import PushFacts
from models.staff import Role, StaffMember
from services.chat import ChatService, parse_key
from services.export import ExportService, cell
from services.notification import NotificationService, render
from services.partner import PartnerService, PartnerTexter
from services.push_jobs import decide, message_for
from settings import SmsConfig
from tests.unit.fakes import FakeFunctions, queued_job
from tests.unit.test_outreach import case_row, partner_row, share_row

NOW = datetime.now(timezone.utc)
DEVON = StaffMember(id=uuid4(), display_name="Devon", role=Role.WORKER)
MARIA, ADA = uuid4(), uuid4()


# --- Team chat ------------------------------------------------------------------------


def message_row(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [{"id": uuid4(), "channel": params["channel"], "case_id": params["case_id"],
             "author_id": params["author_id"], "author_name": "Devon", "body": params["body"],
             "rapid": params["rapid"], "created_at": NOW, "read_by": 0}]


def notification_row(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [{"id": uuid4(), "user_id": params["user_id"], "kind": params["kind"], "dedupe_key": params["dedupe_key"],
             "case_id": params["case_id"], "actor_id": params["actor_id"], "created_at": NOW}]


def chat(db: FakeFunctions) -> ChatService:
    return ChatService(ChatDatabridge(db), NotificationService(NotificationDatabridge(db), db), db)


def members(read: datetime | None = None) -> list[dict[str, Any]]:
    return [{"user_id": DEVON.id, "last_read_at": NOW}, {"user_id": MARIA, "last_read_at": read},
            {"user_id": ADA, "last_read_at": None}]


async def test_an_ordinary_message_goes_to_the_inbox_but_pages_nobody():
    read = NOW - timedelta(minutes=5)
    db = FakeFunctions(chat_message_create=message_row, chat_members=members(read), chat_notify=notification_row,
                       job_enqueue=queued_job)
    sent = await chat(db).send(DEVON, "team", SendChatMessageRequest(body="  Anyone near 27th?  "))
    assert sent.body == "Anyone near 27th?"
    notified = db.called("chat_notify")
    assert [n["user_id"] for n in notified] == [MARIA, ADA]  # never the author
    assert {n["kind"] for n in notified} == {NotificationKind.CHAT_MESSAGE}
    # One row per unread streak: the key is when they last read the channel.
    assert notified[0]["dedupe_key"] == f"chat:team:{read.timestamp():.6f}"
    assert notified[1]["dedupe_key"] == "chat:team:0.000000"
    assert db.called("job_enqueue") == []
    assert db.transactions == 1


async def test_a_rapid_response_message_pushes_each_member_once():
    case_id = uuid4()
    db = FakeFunctions(chat_message_create=message_row, chat_members=members(), chat_notify=notification_row,
                       job_enqueue=queued_job)
    sent = await chat(db).send(DEVON, str(case_id).upper(), SendChatMessageRequest(body="Hold visits", rapid=True))
    notified = db.called("chat_notify")
    assert {n["kind"] for n in notified} == {NotificationKind.CHAT_RAPID}
    assert notified[0]["dedupe_key"] == f"chat:{case_id}:rapid:{sent.id}"
    assert (notified[0]["channel"], notified[0]["case_id"]) == ("case", case_id)
    assert [j["kind"] for j in db.called("job_enqueue")] == ["notification.push", "notification.push"]


async def test_a_message_to_a_missing_case_is_404_and_notifies_nobody():
    db = FakeFunctions(chat_message_create=[])
    with pytest.raises(ApiError) as caught:
        await chat(db).send(DEVON, str(uuid4()), SendChatMessageRequest(body="Hi"))
    assert caught.value.status_code == 404 and db.called("chat_members") == []


def test_channel_keys():
    assert parse_key("team")[0] == "team" and parse_key("oncall") == ("oncall", None)
    case_id = uuid4()
    assert parse_key(str(case_id)) == ("case", case_id)
    with pytest.raises(ApiError):
        parse_key("everyone")


def chat_facts(kind: NotificationKind, channel: str, case_id=None) -> NotificationFacts:
    return NotificationFacts(id=uuid4(), kind=kind, case_id=case_id, case_number=1048 if case_id else None,
                             reader_is_staff=True, chat_channel=channel, created_at=NOW)


def test_the_inbox_names_and_opens_the_channel():
    team = render(chat_facts(NotificationKind.CHAT_MESSAGE, "team"))
    assert (team.title, team.route) == ("New messages in Team chat", "/staff/chat/team")
    case_id = uuid4()
    rapid = render(chat_facts(NotificationKind.CHAT_RAPID, "case", case_id))
    assert (rapid.title, rapid.route) == ("Rapid response in the chat on #1048", f"/staff/chat/{case_id}")


def push_facts(kind: str, channel: str | None, **overrides: Any) -> PushFacts:
    row: dict[str, Any] = {
        "id": uuid4(), "user_id": uuid4(), "kind": kind, "case_id": None, "created_at": NOW, "read_at": None,
        "reader_is_staff": True, "unread_count": 2, "chat_channel": channel,
    }
    return PushFacts(**(row | overrides))


@pytest.mark.parametrize("channel, body", [
    ("team", "New message in Team chat"),
    ("oncall", "New message in On call chat"),
    ("case", "New message in a case chat"),
])
def test_a_rapid_push_names_only_the_channel(channel: str, body: str):
    message = message_for(push_facts("chat_rapid", channel), NOW)
    assert (message.title, message.body, message.thread_id, message.urgent) == ("Rapid response", body, "chat", False)


def test_chat_pushes_respect_quiet_hours_and_ordinary_messages_never_push():
    quiet = push_facts("chat_rapid", "team", quiet_start=(NOW - timedelta(hours=1)).time(),
                       quiet_end=(NOW + timedelta(hours=1)).time(), timezone="UTC")
    assert decide(quiet, NOW, ZoneInfo("UTC")).action == "defer"
    assert decide(push_facts("chat_message", "team"), NOW, ZoneInfo("UTC")).reason == "inbox_only"
    assert decide(push_facts("chat_rapid", "team", muted_kinds=["chat_rapid"]), NOW, ZoneInfo("UTC")).reason == "muted"


# --- Requests to partners ---------------------------------------------------------------


def request_row(params: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [{"id": uuid4(), "case_id": params["case_id"], "partner_id": params["partner_id"],
             "partner_name": "Harbor House", "requested_by": params["requested_by"], "requested_by_name": "Devon",
             "need": params["need"],
             "note": params["note"], "message": params["message"], "delivery": params["delivery"],
             "status": "pending" if params["delivery"] == "sms" else "composed",
             "included_contact": params["included_contact"], "included_location": params["included_location"],
             "created_at": NOW}]


def partner_db(case: dict[str, Any], partner: dict[str, Any], shares: list[dict[str, Any]]) -> FakeFunctions:
    return FakeFunctions(case_get=[case], partner_get=[partner], case_share_list=shares,
                         partner_request_create=request_row)


def ask(**overrides: Any) -> CreatePartnerRequest:
    return CreatePartnerRequest(**({"partner_id": uuid4(), "need": CaseCategory.HOMELESSNESS,
                                    "note": "A family bed tonight?"} | overrides))


async def test_without_a_share_a_request_says_only_the_need_the_note_the_case_and_who():
    case, partner = case_row(), partner_row(phone=None)
    db = partner_db(case, partner, [])
    sent = await PartnerService(PartnerDatabridge(db), CaseDatabridge(db), db, sms_enabled=True).request_help(
        DEVON, case["id"], ask(partner_id=partner["id"]))
    assert sent.request.delivery == "compose"  # no textable number: the worker sends it
    for private in ("Dana", "414-555-0199", "N 27th", "Sleeping"):
        assert private not in sent.message
    assert "case #1048" in sent.message and "Housing and shelter" in sent.message and "Devon" in sent.message
    (created,) = db.called("partner_request_create")
    assert (created["included_contact"], created["included_location"]) == (False, False)


async def test_a_live_share_lets_what_it_included_go_and_a_textable_partner_is_texted():
    case, partner = case_row(), partner_row()
    shares = [share_row(case, partner, include_contact=True),
              share_row(case, partner_row(), include_location=True)]  # another partner's share doesn't count
    db = partner_db(case, partner, shares)
    sent = await PartnerService(PartnerDatabridge(db), CaseDatabridge(db), db, sms_enabled=True).request_help(
        DEVON, case["id"], ask(partner_id=partner["id"]))
    assert sent.request.delivery == "sms" and "Phone: 414-555-0199" in sent.message and "N 27th" not in sent.message
    revoked = [share_row(case, partner, include_contact=True, revoked_at=NOW)]
    db = partner_db(case, partner, revoked)
    quiet = await PartnerService(PartnerDatabridge(db), CaseDatabridge(db), db).request_help(
        DEVON, case["id"], ask(partner_id=partner["id"]))
    assert quiet.request.delivery == "compose" and "414-555-0199" not in quiet.message


async def test_an_inactive_partner_cant_be_asked():
    case, partner = case_row(), partner_row(active=False)
    db = partner_db(case, partner, [])
    with pytest.raises(ApiError) as caught:
        await PartnerService(PartnerDatabridge(db), CaseDatabridge(db), db).request_help(
            DEVON, case["id"], ask(partner_id=partner["id"]))
    assert caught.value.code == "partner_inactive" and db.called("partner_request_create") == []


async def test_the_partner_texter_sends_pending_requests_and_fails_bad_numbers():
    good, bad, later = uuid4(), uuid4(), uuid4()
    marked: list[Mapping[str, Any]] = []

    def mark(params: Mapping[str, Any]) -> list[dict[str, Any]]:
        marked.append(params)
        return []

    db = FakeFunctions(
        partner_request_pending=[
            {"id": good, "case_id": uuid4(), "partner_phone": "(414) 555-0100", "message": "Help?"},
            {"id": bad, "case_id": uuid4(), "partner_phone": "555", "message": "Help?"},
            {"id": later, "case_id": uuid4(), "partner_phone": "414-555-0101", "message": "Later"},
        ],
        partner_request_mark=mark,
    )

    class Flaky(FakeSms):
        async def send(self, to: str, body: str) -> SmsResult:
            if body == "Later":
                return SmsResult(sent=False, reason="twilio_503", retry=True)
            return await super().send(to, body)

    sms = Flaky()
    assert await PartnerTexter(PartnerDatabridge(db), sms).sweep() == 1
    assert sms.sent == [("+14145550100", "Help?")]
    assert [(m["request_id"], m["status"], m["reason"]) for m in marked] == [(good, "sent", None),
                                                                             (bad, "failed", "invalid_number")]


def test_texts_are_configured_only_with_a_provider_and_its_credentials():
    assert not sms_configured(SmsConfig())
    assert sms_configured(SmsConfig(provider="fake"))
    assert not sms_configured(SmsConfig(provider="twilio"))
    assert sms_configured(SmsConfig(provider="twilio", twilio_account_sid="AC1", twilio_auth_token="t",
                                    from_number="+14145550000"))


# --- Who delivered the help ---------------------------------------------------------------


def test_who_delivered_goes_only_with_a_completed_referral():
    assert UpdateReferralRequest(status="completed", delivered_by="comforce").delivered_by == "comforce"
    assert UpdateReferralRequest(delivered_by="provider").status is None  # on one already completed
    with pytest.raises(ValidationError):
        UpdateReferralRequest(status="accepted", delivered_by="provider")
    with pytest.raises(ValidationError):
        UpdateReferralRequest(status="completed", delivered_by="provider", delivered_by_worker_id=uuid4())


# --- Export my records -----------------------------------------------------------------------


async def test_the_export_is_one_csv_with_a_summary_and_only_the_callers_records():
    case = {"id": uuid4(), "number": 1048, "title": "Ride to dialysis", "kind": "request",
            "category": "transportation", "priority": "medium", "status": "resolved", "source": "public",
            "assigned": True, "created": False, "created_at": NOW, "resolved_at": NOW, "referrals": 2, "helped": 1}
    db = FakeFunctions(
        export_debriefs=[{"id": uuid4(), "created_at": NOW, "status": "confirmed", "source": "audio",
                          "title": "Ride needed", "summary": "Needs a ride.", "risk_flags": "=HYPERLINK()",
                          "case_number": 1048}],
        export_cases=[case, case | {"id": uuid4(), "number": 1049, "status": "new", "helped": 0}],
        export_tasks=[],
        export_outcomes=[{"id": uuid4(), "case_id": case["id"], "case_number": 1048, "resource_name": "Ride Line",
                          "status": "completed", "delivered_by": "comforce", "delivered_by_worker_name": "Maria",
                          "outcome": "Got there", "confirmed_at": NOW}],
    )
    export = await ExportService(ExportDatabridge(db)).mine(DEVON, now=NOW)
    assert {p["user_id"] for name in ("export_debriefs", "export_cases", "export_tasks", "export_outcomes")
            for p in db.called(name)} == {DEVON.id}
    s = export.summary
    assert (s.debriefs, s.cases, s.cases_resolved, s.people_helped, s.tasks_completed, s.outcomes_confirmed,
            s.referrals_helped) == (1, 2, 1, 1, 0, 1, 1)
    lines = export.csv.splitlines()
    assert lines[0] == "ComForce MKE: records export" and lines[1] == "Worker,Devon"
    for section in ("Debriefs", "Cases", "Tasks completed", "Referral outcomes confirmed"):
        assert section in lines
    assert "ComForce MKE (Maria)" in export.csv and "'=HYPERLINK()" in export.csv
    assert export.filename == f"comforce-records-{NOW:%Y-%m-%d}.csv"


def test_cells():
    assert (cell(None), cell(True), cell("-1"), cell("ok")) == ("", "yes", "'-1", "ok")
