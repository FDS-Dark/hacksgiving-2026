"""On call: the default end of a switched-on shift, the time rules, and how
the SQL's outcomes become errors (services/oncall.py), against in-memory
stored functions (tests/unit/fakes.py)."""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from databridge.oncall import OncallDatabridge
from errors import ApiError
from models.oncall import CreateShiftRequest, ToggleOncallRequest, UpdateShiftRequest
from models.staff import Role, StaffMember
from services.oncall import OncallService, default_until
from tests.unit.fakes import FakeFunctions

CHICAGO = ZoneInfo("America/Chicago")
NOW = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)  # 12:00 in Chicago
ME = StaffMember(id=uuid4(), display_name="Maria Santos", role=Role.WORKER)
ADMIN = StaffMember(id=uuid4(), display_name="Ada Admin", role=Role.ADMIN)


def local(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=CHICAGO)


def shift_row(
    user_id: UUID | None = None, *, slot: str | None = None, rank: int = 1, outcome: str | None = None,
    starts_at: datetime = NOW - timedelta(hours=1), ends_at: datetime = NOW + timedelta(hours=5),
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": uuid4(), "user_id": user_id or uuid4(), "display_name": "Someone",
        "starts_at": starts_at, "ends_at": ends_at, "rank": rank, "source": "schedule",
    }
    if slot:
        row["slot"] = slot
    if outcome:
        row["outcome"] = outcome
    return row


def service(db: FakeFunctions) -> OncallService:
    return OncallService(OncallDatabridge(db), db, CHICAGO, clock=lambda: NOW)


# --- The default end ------------------------------------------------------------


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (local(2026, 11, 21, 6, 59), local(2026, 11, 21, 7)),
        (local(2026, 11, 21, 7, 0), local(2026, 11, 21, 17)),  # exactly on a boundary: the next one
        (local(2026, 11, 21, 12, 0), local(2026, 11, 21, 17)),
        (local(2026, 11, 21, 17, 0), local(2026, 11, 21, 23)),
        (local(2026, 11, 21, 23, 30), local(2026, 11, 22, 7)),  # across midnight
        (local(2026, 11, 22, 0, 15), local(2026, 11, 22, 7)),
        (local(2026, 12, 31, 23, 0), local(2027, 1, 1, 7)),  # across the year
    ],
)
def test_the_default_end_is_the_next_shift_boundary(now, expected):
    assert default_until(now.astimezone(timezone.utc), CHICAGO) == expected


def test_the_default_end_keeps_the_wall_clock_when_clocks_go_back():
    # 2026-11-01: 02:00 CDT becomes 01:00 CST. 23:30 CDT the night before -> 07:00 CST.
    now = datetime(2026, 11, 1, 4, 30, tzinfo=timezone.utc)  # 23:30 CDT on Oct 31
    until = default_until(now, CHICAGO)
    assert until == local(2026, 11, 1, 7)
    assert until.astimezone(timezone.utc) == datetime(2026, 11, 1, 13, 0, tzinfo=timezone.utc)
    assert until - now == timedelta(hours=8, minutes=30)  # the extra hour is real


def test_the_default_end_keeps_the_wall_clock_when_clocks_go_forward():
    # 2027-03-14: 02:00 CST becomes 03:00 CDT.
    now = datetime(2027, 3, 14, 5, 30, tzinfo=timezone.utc)  # 23:30 CST on Mar 13
    until = default_until(now, CHICAGO)
    assert until == local(2027, 3, 14, 7)
    assert until.astimezone(timezone.utc) == datetime(2027, 3, 14, 12, 0, tzinfo=timezone.utc)
    assert until - now == timedelta(hours=6, minutes=30)


def test_the_default_end_uses_the_configured_zone():
    assert default_until(NOW, ZoneInfo("UTC")) == datetime(2026, 11, 21, 23, 0, tzinfo=timezone.utc)


# --- Who is on now --------------------------------------------------------------


async def test_now_puts_primary_first_and_says_whether_i_am_on():
    backup, primary = shift_row(ME.id, slot="current", rank=2), shift_row(slot="current", rank=1)
    upcoming = shift_row(slot="next", starts_at=NOW + timedelta(hours=5), ends_at=NOW + timedelta(hours=11))
    db = FakeFunctions(oncall_now=[backup, primary, upcoming])

    now = await service(db).now(ME)

    assert [s.id for s in now.on_call] == [primary["id"], backup["id"]]
    assert now.next is not None and now.next.id == upcoming["id"]
    assert now.me.on_call and now.me.shift is not None and now.me.shift.id == backup["id"]


async def test_nobody_on_call():
    now = await service(FakeFunctions(oncall_now=[])).now(ME)
    assert (now.on_call, now.next, now.me.on_call, now.me.shift) == ([], None, False, None)


# --- The switch -----------------------------------------------------------------


async def test_switching_on_sends_the_default_end_and_answers_in_one_transaction():
    db = FakeFunctions(oncall_toggle=[], oncall_now=[shift_row(ME.id, slot="current")])

    now = await service(db).toggle(ME, ToggleOncallRequest(on=True))

    assert db.called("oncall_toggle") == [
        {"user_id": ME.id, "on": True, "until": None, "default_until": local(2026, 11, 21, 17)}
    ]
    assert db.transactions == 1 and now.me.on_call


async def test_switching_on_until_a_chosen_time():
    until = NOW + timedelta(hours=3)
    db = FakeFunctions(oncall_toggle=[], oncall_now=[])

    await service(db).toggle(ME, ToggleOncallRequest(on=True, until=until))

    assert db.called("oncall_toggle")[0]["until"] == until


@pytest.mark.parametrize(
    "until", [NOW, NOW - timedelta(minutes=1), NOW + timedelta(hours=24, seconds=1)]
)
async def test_until_must_be_in_the_next_24_hours(until):
    db = FakeFunctions()

    with pytest.raises(ApiError) as err:
        await service(db).toggle(ME, ToggleOncallRequest(on=True, until=until))

    assert (err.value.status_code, err.value.code) == (422, "invalid_until")
    assert db.calls == []


async def test_until_may_be_exactly_24_hours_away():
    db = FakeFunctions(oncall_toggle=[], oncall_now=[])
    await service(db).toggle(ME, ToggleOncallRequest(on=True, until=NOW + timedelta(hours=24)))
    assert len(db.called("oncall_toggle")) == 1


async def test_switching_off_ignores_until_and_sends_no_default():
    db = FakeFunctions(oncall_toggle=[], oncall_now=[])

    now = await service(db).toggle(ME, ToggleOncallRequest(on=False, until=NOW - timedelta(hours=1)))

    assert db.called("oncall_toggle") == [{"user_id": ME.id, "on": False, "until": None, "default_until": None}]
    assert not now.me.on_call


# --- The rota -------------------------------------------------------------------


async def test_the_list_range_is_at_most_31_days():
    db = FakeFunctions(oncall_shift_list=[])

    await service(db).search(NOW, NOW + timedelta(days=31))
    with pytest.raises(ApiError) as too_long:
        await service(db).search(NOW, NOW + timedelta(days=31, seconds=1))
    with pytest.raises(ApiError) as backwards:
        await service(db).search(NOW, NOW)

    assert (too_long.value.status_code, too_long.value.code) == (422, "range_too_long")
    assert (backwards.value.status_code, backwards.value.code) == (422, "invalid_range")
    assert db.called("oncall_shift_list") == [{"from": NOW, "to": NOW + timedelta(days=31)}]


async def test_an_admin_creates_a_scheduled_shift():
    saved = shift_row(ME.id, outcome="saved")
    db = FakeFunctions(oncall_shift_save=[saved])
    body = CreateShiftRequest(user_id=ME.id, starts_at=NOW, ends_at=NOW + timedelta(hours=8))

    shift = await service(db).create(ADMIN, body)

    assert shift.id == saved["id"]
    assert db.called("oncall_shift_save") == [{
        "id": None, "user_id": ME.id, "starts_at": NOW, "ends_at": NOW + timedelta(hours=8),
        "rank": 1, "source": "schedule", "actor_id": ADMIN.id,
    }]


async def test_a_shift_must_end_after_it_starts():
    db = FakeFunctions()
    with pytest.raises(ApiError) as err:
        await service(db).create(ADMIN, CreateShiftRequest(user_id=ME.id, starts_at=NOW, ends_at=NOW))
    assert (err.value.status_code, err.value.code) == (422, "invalid_range")
    assert db.calls == []


@pytest.mark.parametrize(
    ("outcome", "status", "code"),
    [
        ("overlap", 409, "shift_overlap"),
        ("not_a_worker", 422, "not_a_worker"),
        ("not_found", 404, "shift_not_found"),
        ("invalid_range", 422, "invalid_range"),
    ],
)
async def test_what_the_sql_refuses_becomes_an_error(outcome, status, code):
    db = FakeFunctions(oncall_shift_save=[{"outcome": outcome}])

    with pytest.raises(ApiError) as err:
        await service(db).update(ADMIN, uuid4(), UpdateShiftRequest(ends_at=NOW))

    assert (err.value.status_code, err.value.code) == (status, code)


async def test_an_update_sends_only_what_changes():
    shift_id = uuid4()
    db = FakeFunctions(oncall_shift_save=[shift_row(outcome="saved", rank=2)])

    shift = await service(db).update(ADMIN, shift_id, UpdateShiftRequest(rank=2))

    assert shift.rank == 2
    assert db.called("oncall_shift_save") == [{
        "id": shift_id, "user_id": None, "starts_at": None, "ends_at": None,
        "rank": 2, "source": None, "actor_id": ADMIN.id,
    }]


async def test_an_empty_update_is_refused():
    with pytest.raises(ApiError) as err:
        await service(FakeFunctions()).update(ADMIN, uuid4(), UpdateShiftRequest())
    assert err.value.code == "no_changes"


async def test_deleting_a_missing_shift_is_404():
    db = FakeFunctions(oncall_shift_delete=[])
    with pytest.raises(ApiError) as err:
        await service(db).delete(uuid4())
    assert (err.value.status_code, err.value.code) == (404, "shift_not_found")


def test_naive_times_are_refused():
    with pytest.raises(ValueError):
        ToggleOncallRequest(on=True, until=datetime(2026, 11, 21, 17, 0))


def test_the_org_time_zone_defaults_to_chicago_and_can_be_set(monkeypatch):
    from settings import AppConfig

    monkeypatch.delenv("APP__ONCALL__TIMEZONE", raising=False)
    assert AppConfig().oncall.timezone == "America/Chicago"
    monkeypatch.setenv("APP__ONCALL__TIMEZONE", "America/New_York")
    assert AppConfig().oncall.timezone == "America/New_York"
    monkeypatch.setenv("APP__ONCALL__TIMEZONE", "Mars/Olympus_Mons")
    with pytest.raises(ValueError, match="Unknown time zone"):
        AppConfig()
