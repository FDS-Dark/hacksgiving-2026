"""Volunteer and job opportunities over HTTP against real PostgreSQL: staff
post and close them, residents search only the open ones."""

from uuid import uuid4

import pytest

from tests.helpers import auth_header


@pytest.fixture
async def people(api, admin_conn):
    worker, member = auth_header(f"auth0|{uuid4().hex}", name="Wes Worker"), auth_header(f"auth0|{uuid4().hex}")
    worker_id = (await api.get("/v1/me", headers=worker)).json()["id"]
    await api.get("/v1/me", headers=member)
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    return {"worker": worker, "member": member}


async def test_staff_post_and_close_and_residents_search(api, people):
    worker, member = people["worker"], people["member"]
    tag = uuid4().hex[:8]

    job = await api.post("/v1/opportunities", headers=worker, json={
        "kind": "job", "title": f"Line cook {tag}", "organization": "Northside Kitchen",
        "description": "Prep and line work; we train.", "pay": "$17/hour", "schedule": "Weekday evenings",
        "apply_url": "https://example.org/apply",
    })
    volunteer = await api.post("/v1/opportunities", headers=worker, json={
        "kind": "volunteer", "title": f"Pantry helper {tag}", "organization": "Harambee Pantry",
        "location": "Harambee",
    })
    assert (job.status_code, volunteer.status_code) == (201, 201)

    # Residents can't post.
    denied = await api.post("/v1/opportunities", headers=member, json={
        "kind": "job", "title": "x", "organization": "y"})
    assert denied.status_code == 403

    found = (await api.get("/v1/opportunities", headers=member, params={"q": tag})).json()
    assert {o["title"] for o in found} == {f"Line cook {tag}", f"Pantry helper {tag}"}
    jobs = (await api.get("/v1/opportunities", headers=member, params={"q": tag, "kind": "job"})).json()
    assert [o["kind"] for o in jobs] == ["job"]

    closed = await api.patch(f"/v1/opportunities/{job.json()['id']}", headers=worker, json={"active": False})
    assert closed.status_code == 200 and closed.json()["active"] is False

    # Closed postings disappear for residents (even when they ask for them)...
    resident_view = (await api.get("/v1/opportunities", headers=member,
                                   params={"q": tag, "include_closed": True})).json()
    assert [o["title"] for o in resident_view] == [f"Pantry helper {tag}"]
    assert (await api.get(f"/v1/opportunities/{job.json()['id']}", headers=member)).status_code == 404

    # ...but staff still see them.
    staff_view = (await api.get("/v1/opportunities", headers=worker,
                                params={"q": tag, "include_closed": True})).json()
    assert len(staff_view) == 2
    assert (await api.get(f"/v1/opportunities/{job.json()['id']}", headers=worker)).status_code == 200


async def test_an_apply_link_must_be_a_web_address(api, people):
    bad = await api.post("/v1/opportunities", headers=people["worker"], json={
        "kind": "volunteer", "title": "Mentor", "organization": "ComForce", "apply_url": "javascript:alert(1)"})
    assert bad.status_code == 422
