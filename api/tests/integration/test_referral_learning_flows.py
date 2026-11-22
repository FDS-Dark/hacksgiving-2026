"""Referrals that learn, against real PostgreSQL: suggestions rank by how
earlier referrals to each resource turned out, and say the nearest bus stop."""

from uuid import uuid4

import pytest

from tests.helpers import auth_header


@pytest.fixture
async def worker(api, admin_conn):
    headers = auth_header(f"auth0|{uuid4().hex}", name="Maria Santos")
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'admin' WHERE id = $1", user_id)
    return headers


async def _resource(api, worker, name, **extra):
    response = await api.post("/v1/resources", headers=worker, json={
        "name": name, "category": "burial_assistance", "description": "Help with funeral costs."} | extra)
    assert response.status_code == 201, response.text
    return response.json()


async def _refer(api, worker, resource, status):
    body = {"title": "Funeral", "category": "burial_assistance"}
    case = (await api.post("/v1/cases", headers=worker, json=body)).json()
    referral = (await api.post(f"/v1/cases/{case['id']}/referrals", headers=worker,
                               json={"resource_id": resource["id"]})).json()
    if status != "suggested":
        changed = await api.patch(f"/v1/cases/{case['id']}/referrals/{referral['id']}", headers=worker,
                                  json={"status": status})
        assert changed.status_code == 200, changed.text


async def test_suggestions_rank_by_outcomes_and_name_the_nearest_stop(api, worker, admin_conn):
    tag = uuid4().hex[:6]
    proven = await _resource(api, worker, f"Proven {tag}", latitude=43.0389, longitude=-87.9065)
    poor = await _resource(api, worker, f"Poor {tag}")
    for status in ("completed", "accepted", "completed"):
        await _refer(api, worker, proven, status)
    for status in ("declined", "declined", "declined"):
        await _refer(api, worker, poor, status)

    await admin_conn.execute(
        "INSERT INTO app.transit_stops (source, external_id, code, name, latitude, longitude, routes, last_seen_at) "
        "VALUES ('test', $1, '123', $2, 43.0392, -87.9068, '{30,GRE}', now()) ON CONFLICT DO NOTHING",
        f"stop-{tag}", f"Wisconsin & Water {tag}",
    )

    case = (await api.post("/v1/cases", headers=worker, json={
        "title": "Needs help with burial costs", "category": "burial_assistance"})).json()
    response = await api.post(f"/v1/cases/{case['id']}/assist/resources", headers=worker)
    assert response.status_code == 200, response.text
    found = [s for s in response.json()["suggestions"] if tag in s["resource"]["name"]]
    names = [s["resource"]["name"] for s in found]
    assert names[0] == f"Proven {tag}"
    if f"Poor {tag}" in names:
        assert names.index(f"Poor {tag}") > 0

    best = found[0]
    assert best["outcomes"] == {"referred": 3, "helped": 3, "declined": 0, "success_rate": 1.0}
    assert "Helped 3 of 3" in best["reason"]
    stop = best["nearest_stop"]
    assert stop["name"] == f"Wisconsin & Water {tag}" and stop["routes"] == ["30", "GRE"] and stop["distance_m"] < 100
