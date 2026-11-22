"""On call over HTTP against real PostgreSQL, as the app role: the switch,
the rota an admin keeps, who is next, and who may do what."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from tests.helpers import auth_header


def _sub() -> str:
    return f"auth0|{uuid4().hex}"


def _iso(moment: datetime) -> str:
    return moment.isoformat()


@pytest.fixture
async def people(api, admin_conn):
    """An admin, two workers and a member, with no shifts. Roles are set
    directly; the table is emptied so tests don't see each other's shifts."""
    await admin_conn.execute("DELETE FROM app.oncall_shifts")
    found = {}
    for key, role, name in (
        ("admin", "admin", "Ada Admin"), ("maria", "worker", "Maria Santos"),
        ("devon", "worker", "Devon Park"), ("member", "member", "Casey"),
    ):
        header = auth_header(_sub(), name=name)
        user_id = (await api.get("/v1/me", headers=header)).json()["id"]
        await admin_conn.execute("UPDATE app.users SET role = $1 WHERE id = $2", role, user_id)
        found[key], found[f"{key}_id"] = header, user_id
    return found


async def test_switching_on_and_off(api, people):
    maria = people["maria"]

    before = (await api.get("/v1/oncall/now", headers=maria)).json()
    assert before == {"on_call": [], "next": None, "me": {"on_call": False, "shift": None}}

    on = await api.post("/v1/oncall/me", headers=maria, json={"on": True})
    assert on.status_code == 200
    body = on.json()
    assert body["me"]["on_call"] is True
    shift = body["me"]["shift"]
    assert (shift["user_id"], shift["display_name"], shift["source"], shift["rank"]) == (
        people["maria_id"], "Maria Santos", "toggle", 1)
    ends = datetime.fromisoformat(shift["ends_at"])
    assert timedelta(0) < ends - datetime.now(timezone.utc) <= timedelta(hours=16)
    assert [s["id"] for s in body["on_call"]] == [shift["id"]]

    # Another worker sees Maria on.
    seen = (await api.get("/v1/oncall/now", headers=people["devon"])).json()
    assert [s["user_id"] for s in seen["on_call"]] == [people["maria_id"]] and not seen["me"]["on_call"]

    # On again with an end time moves the end; on again without one changes nothing.
    until = datetime.now(timezone.utc) + timedelta(hours=20)
    moved = (await api.post("/v1/oncall/me", headers=maria, json={"on": True, "until": _iso(until)})).json()
    assert moved["me"]["shift"]["id"] == shift["id"]
    assert datetime.fromisoformat(moved["me"]["shift"]["ends_at"]) == until
    same = (await api.post("/v1/oncall/me", headers=maria, json={"on": True})).json()
    assert same["me"]["shift"] == moved["me"]["shift"]

    off = (await api.post("/v1/oncall/me", headers=maria, json={"on": False})).json()
    assert off == {"on_call": [], "next": None, "me": {"on_call": False, "shift": None}}
    again = await api.post("/v1/oncall/me", headers=maria, json={"on": False})
    assert again.status_code == 200 and again.json()["me"]["on_call"] is False

    late = await api.post("/v1/oncall/me", headers=maria, json={
        "on": True, "until": _iso(datetime.now(timezone.utc) + timedelta(hours=25))})
    past = await api.post("/v1/oncall/me", headers=maria, json={
        "on": True, "until": _iso(datetime.now(timezone.utc) - timedelta(minutes=5))})
    assert [late.json()["code"], past.json()["code"]] == ["invalid_until", "invalid_until"]
    assert late.status_code == past.status_code == 422


async def test_switching_on_stops_at_my_next_shift(api, people):
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    created = await api.post("/v1/oncall/shifts", headers=people["admin"], json={
        "user_id": people["maria_id"], "starts_at": _iso(start), "ends_at": _iso(start + timedelta(hours=8))})
    assert created.status_code == 201

    on = (await api.post("/v1/oncall/me", headers=people["maria"], json={
        "on": True, "until": _iso(datetime.now(timezone.utc) + timedelta(hours=6))})).json()

    assert datetime.fromisoformat(on["me"]["shift"]["ends_at"]) == start


async def test_an_admin_keeps_the_rota(api, people):
    admin, base = people["admin"], datetime(2030, 1, 6, 13, 0, tzinfo=timezone.utc)

    created = await api.post("/v1/oncall/shifts", headers=admin, json={
        "user_id": people["maria_id"], "starts_at": _iso(base), "ends_at": _iso(base + timedelta(hours=10))})
    assert created.status_code == 201
    shift = created.json()
    assert (shift["source"], shift["rank"], shift["display_name"]) == ("schedule", 1, "Maria Santos")

    overlapping = await api.post("/v1/oncall/shifts", headers=admin, json={
        "user_id": people["maria_id"], "starts_at": _iso(base + timedelta(hours=9)),
        "ends_at": _iso(base + timedelta(hours=12))})
    assert (overlapping.status_code, overlapping.json()["code"]) == (409, "shift_overlap")

    # Back to back is fine, and so is someone else at the same time.
    after = await api.post("/v1/oncall/shifts", headers=admin, json={
        "user_id": people["maria_id"], "starts_at": _iso(base + timedelta(hours=10)),
        "ends_at": _iso(base + timedelta(hours=16))})
    backup = await api.post("/v1/oncall/shifts", headers=admin, json={
        "user_id": people["devon_id"], "starts_at": _iso(base), "ends_at": _iso(base + timedelta(hours=10)),
        "rank": 2})
    assert (after.status_code, backup.status_code) == (201, 201)

    member_shift = await api.post("/v1/oncall/shifts", headers=admin, json={
        "user_id": people["member_id"], "starts_at": _iso(base), "ends_at": _iso(base + timedelta(hours=1))})
    assert (member_shift.status_code, member_shift.json()["code"]) == (422, "not_a_worker")

    # PATCH: only what's sent changes; the merged shift is checked.
    moved = await api.patch(f"/v1/oncall/shifts/{shift['id']}", headers=admin,
                            json={"starts_at": _iso(base - timedelta(hours=2))})
    assert moved.status_code == 200
    assert datetime.fromisoformat(moved.json()["starts_at"]) == base - timedelta(hours=2)
    assert datetime.fromisoformat(moved.json()["ends_at"]) == base + timedelta(hours=10)
    backwards = await api.patch(f"/v1/oncall/shifts/{shift['id']}", headers=admin,
                                json={"ends_at": _iso(base - timedelta(hours=3))})
    assert (backwards.status_code, backwards.json()["code"]) == (422, "invalid_range")
    into_next = await api.patch(f"/v1/oncall/shifts/{shift['id']}", headers=admin,
                                json={"ends_at": _iso(base + timedelta(hours=11))})
    assert (into_next.status_code, into_next.json()["code"]) == (409, "shift_overlap")
    handed = await api.patch(f"/v1/oncall/shifts/{shift['id']}", headers=admin,
                             json={"user_id": people["devon_id"]})
    assert (handed.status_code, handed.json()["code"]) == (409, "shift_overlap")

    assert (await api.delete(f"/v1/oncall/shifts/{shift['id']}", headers=admin)).status_code == 204
    gone = await api.delete(f"/v1/oncall/shifts/{shift['id']}", headers=admin)
    assert (gone.status_code, gone.json()["code"]) == (404, "shift_not_found")
    missing = await api.patch(f"/v1/oncall/shifts/{shift['id']}", headers=admin, json={"rank": 2})
    assert missing.status_code == 404


async def test_who_may_do_what(api, people):
    member, worker, admin = people["member"], people["maria"], people["admin"]
    base = datetime(2030, 2, 1, 13, 0, tzinfo=timezone.utc)
    body = {"user_id": people["maria_id"], "starts_at": _iso(base), "ends_at": _iso(base + timedelta(hours=1))}
    shift_id = (await api.post("/v1/oncall/shifts", headers=admin, json=body)).json()["id"]
    window = {"from": _iso(base), "to": _iso(base + timedelta(days=1))}

    for response in (
        await api.get("/v1/oncall/now", headers=member),
        await api.post("/v1/oncall/me", headers=member, json={"on": True}),
        await api.get("/v1/oncall/shifts", headers=member, params=window),
        await api.post("/v1/oncall/shifts", headers=member, json=body),
        await api.post("/v1/oncall/shifts", headers=worker, json=body),
        await api.patch(f"/v1/oncall/shifts/{shift_id}", headers=worker, json={"rank": 2}),
        await api.delete(f"/v1/oncall/shifts/{shift_id}", headers=worker),
    ):
        assert response.status_code == 403
    assert (await api.get("/v1/oncall/shifts", headers=worker, params=window)).status_code == 200
    assert (await api.get("/v1/oncall/now")).status_code == 401


async def test_next_in_line_and_the_list_range(api, people, admin_conn):
    admin, now = people["admin"], datetime.now(timezone.utc)

    async def shift(who: str, starts: timedelta, hours: float, rank: int = 1) -> dict:
        response = await api.post("/v1/oncall/shifts", headers=admin, json={
            "user_id": people[f"{who}_id"], "starts_at": _iso(now + starts),
            "ends_at": _iso(now + starts + timedelta(hours=hours)), "rank": rank})
        assert response.status_code == 201, response.json()
        return response.json()

    maria_now = await shift("maria", -timedelta(hours=1), 3)
    # Maria again later: she's on now, so this isn't "next".
    await shift("maria", timedelta(hours=3), 2)
    devon_later = await shift("devon", timedelta(hours=4), 4)
    # Too far out to be next.
    await shift("admin", timedelta(hours=13), 4)

    seen = (await api.get("/v1/oncall/now", headers=people["devon"])).json()
    assert [s["id"] for s in seen["on_call"]] == [maria_now["id"]]
    assert seen["next"]["id"] == devon_later["id"] and seen["next"]["display_name"] == "Devon Park"

    # A backup on now comes after the primary.
    admin_backup = await shift("admin", -timedelta(minutes=30), 1, rank=2)
    seen = (await api.get("/v1/oncall/now", headers=people["admin"])).json()
    assert [s["id"] for s in seen["on_call"]] == [maria_now["id"], admin_backup["id"]]
    assert seen["me"]["shift"]["id"] == admin_backup["id"]

    # Someone demoted to member drops out.
    await admin_conn.execute("UPDATE app.users SET role = 'member' WHERE id = $1", people["devon_id"])
    assert (await api.get("/v1/oncall/now", headers=admin)).json()["next"] is None

    window = {"from": _iso(now + timedelta(hours=2, minutes=30)), "to": _iso(now + timedelta(hours=5))}
    listed = (await api.get("/v1/oncall/shifts", headers=admin, params=window)).json()
    assert [s["starts_at"] for s in listed] == sorted(s["starts_at"] for s in listed)
    assert {s["user_id"] for s in listed} == {people["maria_id"], people["devon_id"]}
    assert len(listed) == 2  # Maria's later shift and Devon's; nothing outside the window

    too_long = await api.get("/v1/oncall/shifts", headers=admin, params={
        "from": _iso(now), "to": _iso(now + timedelta(days=32))})
    assert (too_long.status_code, too_long.json()["code"]) == (422, "range_too_long")
    naive = await api.get("/v1/oncall/shifts", headers=admin, params={
        "from": "2030-01-01T00:00:00", "to": "2030-01-02T00:00:00"})
    assert naive.status_code == 422
