"""Weather alerts against real PostgreSQL, as the app role: the worker acts
on each alert once, cold gives open homelessness cases a check-in task, and
residents who opted in to community alerts get one notification."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from databridge.notification import NotificationDatabridge
from databridge.public_data import PublicDataDatabridge
from models.public_data import ImportedWeatherAlert
from services.notification import NotificationService
from services.weather_jobs import WeatherWatch
from tests.helpers import auth_header
from tests.integration.conftest import app_executor


async def _person(api, admin_conn, name: str, role: str = "member") -> dict:
    headers = auth_header(f"auth0|{uuid4().hex}", name=name)
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    if role != "member":
        await admin_conn.execute("UPDATE app.users SET role = $1 WHERE id = $2", role, user_id)
    return {"headers": headers, "id": user_id}


async def _case(api, worker, category: str) -> str:
    body = {"title": "Needs a bed", "category": category}
    response = await api.post("/v1/cases", headers=worker["headers"], json=body)
    assert response.status_code == 201
    return response.json()["id"]


@pytest.fixture
async def watch(database):
    executor = app_executor(database)
    yield WeatherWatch(executor, NotificationService(NotificationDatabridge(executor), executor)), executor
    await executor.dispose()


async def test_community_alerts_are_off_until_turned_on(api, admin_conn):
    keisha = await _person(api, admin_conn, "Keisha")
    assert (await api.get("/v1/me/community-alerts", headers=keisha["headers"])).json() == {"subscribed": False}
    on = await api.put("/v1/me/community-alerts", headers=keisha["headers"], json={"subscribed": True})
    assert on.json() == {"subscribed": True}
    assert (await api.get("/v1/me/community-alerts", headers=keisha["headers"])).json() == {"subscribed": True}
    off = await api.put("/v1/me/community-alerts", headers=keisha["headers"], json={"subscribed": False})
    assert off.json() == {"subscribed": False}


async def test_a_cold_alert_makes_check_in_tasks_and_alerts_opted_in_residents_once(api, admin_conn, watch):
    sweep, executor = watch
    worker = await _person(api, admin_conn, "Maria Santos", "worker")
    opted_in, opted_out = await _person(api, admin_conn, "Keisha"), await _person(api, admin_conn, "Jordan")
    await api.put("/v1/me/community-alerts", headers=opted_in["headers"], json={"subscribed": True})

    open_shelter = await _case(api, worker, "homelessness")
    closed_shelter = await _case(api, worker, "homelessness")
    await api.patch(f"/v1/cases/{closed_shelter}", headers=worker["headers"], json={"status": "resolved"})
    food = await _case(api, worker, "meal_programs")

    tag, now = uuid4().hex[:6], datetime.now(UTC)
    event = f"Extreme Cold Warning {tag}"
    await PublicDataDatabridge(executor).sync("nws_alerts", [ImportedWeatherAlert(
        external_id=f"urn:{tag}", event=event, severity="Severe", headline="Wind chills near 30 below",
        effective_at=now - timedelta(hours=1), expires_at=now + timedelta(hours=12),
    )], now)

    assert await sweep.sweep() >= 1
    assert await sweep.sweep() == 0  # handled once, whatever else runs

    # Other tests' open homelessness cases share this database and get one
    # too; of this test's three cases, only the open shelter case does.
    rows = await admin_conn.fetch(
        "SELECT id, case_id, assigned_worker_id FROM app.tasks WHERE title = $1 AND case_id::text = ANY($2)",
        f"Check in: {event}", [open_shelter, closed_shelter, food])
    assert [str(r["case_id"]) for r in rows] == [open_shelter]
    assert rows[0]["assigned_worker_id"] is None  # follows whoever holds the case
    reminder = await admin_conn.fetchval(
        "SELECT count(*) FROM app.jobs WHERE kind = 'task.remind' AND payload->>'task_id' = $1", str(rows[0]["id"]))
    assert reminder == 1

    mine = await admin_conn.fetch(
        "SELECT id FROM app.notifications WHERE kind = 'community_alert' AND user_id = $1", opted_in["id"])
    assert len(mine) == 1
    assert await admin_conn.fetchval(
        "SELECT count(*) FROM app.notifications WHERE kind = 'community_alert' AND user_id = $1", opted_out["id"]) == 0

    # The resident can open it (a tapped push): it leads to Safety alerts.
    opened = await api.get(f"/v1/notifications/{mine[0]['id']}", headers=opted_in["headers"])
    assert opened.status_code == 200
    assert (opened.json()["title"], opened.json()["route"]) == ("Weather alert", "/alerts")


async def test_a_minor_wind_alert_does_nothing(api, admin_conn, watch):
    sweep, executor = watch
    worker = await _person(api, admin_conn, "Devon Lee", "worker")
    await _case(api, worker, "homelessness")
    tag, now = uuid4().hex[:6], datetime.now(UTC)
    await PublicDataDatabridge(executor).sync("nws_alerts", [ImportedWeatherAlert(
        external_id=f"urn:{tag}", event=f"Wind Advisory {tag}", severity="Minor",
        effective_at=now - timedelta(minutes=5), expires_at=now + timedelta(hours=3),
    )], now)
    await sweep.sweep()
    assert await admin_conn.fetchval("SELECT count(*) FROM app.tasks WHERE title LIKE $1", f"%{tag}%") == 0
