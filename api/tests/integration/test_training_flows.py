"""Worker training progress against real PostgreSQL: modules are marked done
and undone, required ones decide 'ready', and admins see the team."""

from uuid import uuid4

import pytest

from tests.helpers import auth_header

REQUIRED = ("orientation", "field-safety", "de-escalation", "trauma-informed", "dv-response", "privacy")


async def _person(api, admin_conn, role):
    headers = auth_header(f"auth0|{uuid4().hex}", name=f"Pat {role}")
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = $1 WHERE id = $2", role, user_id)
    return headers, user_id


@pytest.fixture
async def people(api, admin_conn):
    worker, worker_id = await _person(api, admin_conn, "worker")
    admin, _ = await _person(api, admin_conn, "admin")
    return {"worker": worker, "worker_id": worker_id, "admin": admin}


async def test_progress_is_saved_and_required_modules_decide_ready(api, people):
    worker = people["worker"]
    start = (await api.get("/v1/training/progress", headers=worker)).json()
    assert start == {"completed": [], "required_left": 6, "ready": False}

    for module in REQUIRED[:-1]:
        await api.put(f"/v1/training/progress/{module}", headers=worker, json={"done": True})
    almost = (await api.put("/v1/training/progress/first-aid", headers=worker, json={"done": True})).json()
    assert almost["required_left"] == 1 and almost["ready"] is False

    ready = (await api.put("/v1/training/progress/privacy", headers=worker, json={"done": True})).json()
    assert ready["ready"] is True and len(ready["completed"]) == 7
    again = (await api.put("/v1/training/progress/privacy", headers=worker, json={"done": True})).json()
    assert len(again["completed"]) == 7  # marking twice changes nothing

    undone = (await api.put("/v1/training/progress/privacy", headers=worker, json={"done": False})).json()
    assert undone["ready"] is False and undone["required_left"] == 1

    assert (await api.put("/v1/training/progress/not-a-module", headers=worker, json={"done": True})).status_code == 404


async def test_admins_see_the_team_and_workers_dont(api, people):
    await api.put("/v1/training/progress/orientation", headers=people["worker"], json={"done": True})
    team = await api.get("/v1/training/team", headers=people["admin"])
    assert team.status_code == 200
    (me,) = [m for m in team.json() if m["user_id"] == people["worker_id"]]
    assert me["completed"] == ["orientation"] and me["required_left"] == 5
    assert (await api.get("/v1/training/team", headers=people["worker"])).status_code == 403
