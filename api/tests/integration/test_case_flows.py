"""The case workflow over HTTP against real PostgreSQL, as the app role: a
community member asks for help, a worker triages, refers and resolves it,
and each side sees only what it should."""

from uuid import uuid4

import pytest

from tests.helpers import auth_header


def _sub() -> str:
    return f"auth0|{uuid4().hex}"


@pytest.fixture
async def people(api, admin_conn):
    """A worker and a community member. Roles are set directly: bootstrap
    works once per database, and other tests share it."""
    worker, member = auth_header(_sub(), name="Wes Worker"), auth_header(_sub(), name="Casey")
    worker_id = (await api.get("/v1/me", headers=worker)).json()["id"]
    await api.get("/v1/me", headers=member)
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    return {"worker": worker, "worker_id": worker_id, "member": member}


async def test_a_request_goes_from_submission_to_resolution(api, people):
    worker, member = people["worker"], people["member"]

    submitted = await api.post("/v1/requests", headers=member, json={
        "description": "Evicted today, two kids, nowhere to sleep tonight.",
        "location": "N 35th St & W Center St",
        "contact_phone": "414-555-0199",
    })
    assert submitted.status_code == 201
    request = submitted.json()
    assert request["status"] == "new" and "contact_phone" not in request

    queue = (await api.get("/v1/cases", headers=worker, params={"open_only": True})).json()
    case = next(c for c in queue if c["id"] == request["id"])
    assert (case["source"], case["contact_phone"], case["assigned_worker_id"]) == ("public", "414-555-0199", None)

    triaged = await api.patch(f"/v1/cases/{case['id']}", headers=worker, json={
        "assigned_worker_id": people["worker_id"], "status": "in_progress", "priority": "high",
        "category": "homelessness"})
    assert triaged.status_code == 200
    assert triaged.json()["assigned_worker_name"] == "Wes Worker"

    note = await api.post(f"/v1/cases/{case['id']}/updates", headers=worker,
                          json={"content": "Staying with a cousin until 9pm."})
    message = await api.post(f"/v1/cases/{case['id']}/updates", headers=worker,
                             json={"content": "We're finding you a bed tonight.", "visibility": "public"})
    assert (note.status_code, message.status_code) == (201, 201)

    shelters = (await api.get("/v1/resources", headers=worker, params={"category": "homelessness"})).json()
    assert shelters and all(r["category"] == "homelessness" for r in shelters)
    referral = await api.post(f"/v1/cases/{case['id']}/referrals", headers=worker,
                              json={"resource_id": shelters[0]["id"]})
    again = await api.post(f"/v1/cases/{case['id']}/referrals", headers=worker,
                           json={"resource_id": shelters[0]["id"]})
    assert (referral.status_code, again.status_code) == (201, 409)
    done = await api.patch(f"/v1/cases/{case['id']}/referrals/{referral.json()['id']}", headers=worker,
                           json={"status": "completed", "outcome": "Checked in at 7pm."})
    assert done.json()["status"] == "completed"

    resolved = await api.patch(f"/v1/cases/{case['id']}", headers=worker, json={"status": "resolved"})
    assert resolved.json()["resolved_at"] is not None

    detail = (await api.get(f"/v1/cases/{case['id']}", headers=worker)).json()
    types = [u["update_type"] for u in detail["updates"]]
    assert types[0] == "created" and "assignment" in types and "note" in types and "referral" in types
    assert types[-1] == "status_change"
    assert detail["referrals"][0]["outcome"] == "Checked in at 7pm."

    mine = (await api.get(f"/v1/requests/{case['id']}", headers=member)).json()
    seen = [u["content"] for u in mine["updates"]]
    assert mine["request"]["status"] == "resolved"
    assert "We're finding you a bed tonight." in seen
    assert not any("cousin" in s or "Referral" in s or "Assigned" in s for s in seen)

    stats = (await api.get("/v1/cases/insights", headers=worker)).json()["stats"]
    assert stats["resolved"] >= 1 and stats["avg_resolution_hours"] is not None


async def test_the_boundaries_between_members_and_workers(api, people):
    member, worker = people["member"], people["worker"]
    stranger = auth_header(_sub())
    await api.get("/v1/me", headers=stranger)

    request = (await api.post("/v1/requests", headers=member, json={"description": "Need groceries"})).json()

    assert (await api.get("/v1/cases", headers=member)).status_code == 403
    assert (await api.get(f"/v1/cases/{request['id']}", headers=member)).status_code == 403
    assert (await api.post("/v1/requests", headers=member,
                           json={"description": "x", "assigned_worker_id": people["worker_id"]})).status_code == 422
    assert (await api.get(f"/v1/requests/{request['id']}", headers=stranger)).status_code == 404
    assert [r["id"] for r in (await api.get("/v1/requests", headers=stranger)).json()] == []
    member_id = (await api.get("/v1/me", headers=member)).json()["id"]
    assign_member = await api.patch(f"/v1/cases/{request['id']}", headers=worker,
                                    json={"assigned_worker_id": member_id})
    assert assign_member.status_code == 422


async def test_filters_and_search(api, people):
    worker = people["worker"]
    created = await api.post("/v1/cases", headers=worker, json={
        "title": "Fight brewing outside the corner store", "kind": "incident",
        "category": "incident_deescalation", "priority": "critical", "location": "W Burleigh St"})
    assert created.status_code == 201
    number = created.json()["number"]

    by_text = (await api.get("/v1/cases", headers=worker, params={"q": "burleigh"})).json()
    by_number = (await api.get("/v1/cases", headers=worker, params={"q": f"#{number}"})).json()
    critical = (await api.get("/v1/cases", headers=worker, params={"priority": "critical", "kind": "incident"})).json()
    unassigned = (await api.get("/v1/cases", headers=worker, params={"unassigned": True})).json()

    assert [c["number"] for c in by_number] == [number]
    assert number in [c["number"] for c in by_text]
    assert all(c["priority"] == "critical" and c["kind"] == "incident" for c in critical)
    assert all(c["assigned_worker_id"] is None for c in unassigned)


async def test_only_the_first_staff_member_can_bootstrap(api, people):
    # people already made someone a worker, so nobody else can claim admin.
    response = await api.post("/v1/staff/bootstrap", headers=people["member"])
    assert response.status_code == 409


async def test_resources_have_coordinates(api, people):
    worker = people["worker"]
    samples = (await api.get("/v1/resources", headers=worker)).json()
    assert samples and all(r["latitude"] is not None and r["longitude"] is not None
                           for r in samples if r["is_sample"])

    created = await api.post("/v1/resources", headers=worker, json={
        "name": "Corner Pantry", "category": "meal_programs", "latitude": 43.05, "longitude": -87.95,
    })
    assert created.status_code == 201
    assert (created.json()["latitude"], created.json()["longitude"]) == (43.05, -87.95)
    fetched = (await api.get(f"/v1/resources/{created.json()['id']}", headers=worker)).json()
    assert (fetched["latitude"], fetched["longitude"]) == (43.05, -87.95)

    off_the_map = await api.post("/v1/resources", headers=worker, json={
        "name": "Nowhere", "category": "other", "latitude": 95,
    })
    assert off_the_map.status_code == 422


async def test_recently_worked_lists_my_cases_by_my_last_touch(api, people, admin_conn):
    """The Queue's "Recently worked" view: the cases I touched, newest touch
    first, with when and how. Someone else's activity doesn't count."""
    worker = people["worker"]
    other = auth_header(_sub(), name="Olive Other")
    other_id = (await api.get("/v1/me", headers=other)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", other_id)

    first = (await api.post("/v1/cases", headers=worker, json={"title": "Ride to court"})).json()
    second = (await api.post("/v1/cases", headers=worker, json={"title": "Bed tonight"})).json()
    theirs = (await api.post("/v1/cases", headers=other, json={"title": "Not mine"})).json()

    # Touching the first case again moves it back to the top; a teammate's
    # note on the second doesn't.
    await api.post(f"/v1/cases/{first['id']}/updates", headers=worker, json={"content": "Called the court."})
    await api.post(f"/v1/cases/{second['id']}/updates", headers=other, json={"content": "Drove by."})

    recent = await api.get("/v1/cases/recent", headers=worker, params={"limit": 10})
    assert recent.status_code == 200, recent.text
    rows = recent.json()
    ids = [c["id"] for c in rows]
    assert ids[:2] == [first["id"], second["id"]] and theirs["id"] not in ids
    assert (rows[0]["worked_type"], rows[1]["worked_type"]) == ("note", "created")
    assert rows[0]["worked_at"] >= rows[1]["worked_at"]

    member = await api.get("/v1/cases/recent", headers=people["member"])
    assert member.status_code == 403
