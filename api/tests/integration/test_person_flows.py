"""The person behind a case, against real PostgreSQL: their other cases are
found by phone (any formatting) or email, and strangers stay out."""

from uuid import uuid4

import pytest

from tests.helpers import auth_header


@pytest.fixture
async def worker(api, admin_conn):
    headers = auth_header(f"auth0|{uuid4().hex}", name="Maria Santos")
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", user_id)
    return headers


async def _case(api, worker, **body):
    response = await api.post("/v1/cases", headers=worker, json={"title": "Needs help", "category": "other"} | body)
    assert response.status_code == 201, response.text
    return response.json()


async def test_a_persons_cases_are_matched_by_phone_and_email(api, worker):
    suffix = f"{uuid4().int % 10**4:04d}"
    first = await _case(api, worker, title="Ride to dialysis", contact_name="Keisha B.",
                        contact_phone=f"(414) 555-{suffix}")
    second = await _case(api, worker, title="Food pantry", contact_name="Keisha Brown",
                         contact_phone=f"+1 414.555.{suffix}", contact_email=f"keisha{suffix}@example.org")
    third = await _case(api, worker, title="Bus pass", contact_email=f"KEISHA{suffix}@example.org ")
    await _case(api, worker, title="Someone else", contact_phone="414-555-9999", contact_name="Not Keisha")

    response = await api.get(f"/v1/cases/{first['id']}/person", headers=worker)
    assert response.status_code == 200, response.text
    person = response.json()
    # Phone links the first two; the third shares only the second's email, so it isn't reached from the first.
    assert {c["id"] for c in person["cases"]} == {first["id"], second["id"]}
    assert person["matched_by"] == ["phone"] and person["name"] == "Keisha Brown"
    assert person["open_cases"] == 2 and person["has_account"] is False

    from_second = (await api.get(f"/v1/cases/{second['id']}/person", headers=worker)).json()
    assert {c["id"] for c in from_second["cases"]} == {first["id"], second["id"], third["id"]}
    assert set(from_second["matched_by"]) == {"phone", "email"}

    alone = await _case(api, worker, title="No contact details")
    only = (await api.get(f"/v1/cases/{alone['id']}/person", headers=worker)).json()
    assert [c["id"] for c in only["cases"]] == [alone["id"]] and only["matched_by"] == []


async def test_only_staff_see_a_person(api, worker):
    case = await _case(api, worker, contact_phone="414-555-0100")
    resident = auth_header(f"auth0|{uuid4().hex}")
    await api.get("/v1/me", headers=resident)
    assert (await api.get(f"/v1/cases/{case['id']}/person", headers=resident)).status_code == 403
    assert (await api.get(f"/v1/cases/{uuid4()}/person", headers=worker)).status_code == 404
