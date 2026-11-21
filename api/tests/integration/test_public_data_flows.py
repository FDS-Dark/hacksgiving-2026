"""The public-data tables (0014_public_data.sql) against real PostgreSQL, as
the app role: bulk sync is idempotent, the database generalizes locations
itself, small tract counts are suppressed, sensitive and expired calls stay
out of public reads, and retiring removes only what it should."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from databridge.public_data import PublicDataDatabridge
from dependencies import get_public_data_service
from main import app
from models.public_data import (
    ImportedArea,
    ImportedIncident,
    ImportedSignal,
    ImportedTransitAlert,
    ImportedTransitRoute,
    ImportedTransitStop,
    ImportedWeatherAlert,
)
from services.public_data import PublicDataService
from tests.integration.conftest import app_executor

SQUARE = {"type": "Polygon", "coordinates": [[[-88.0, 43.0], [-87.9, 43.0], [-87.9, 43.1], [-88.0, 43.1],
                                              [-88.0, 43.0]]]}


@pytest.fixture
async def data(database):
    executor = app_executor(database)
    yield PublicDataDatabridge(executor)
    await executor.dispose()


@pytest.fixture
async def client(data):
    async def no_trips() -> bytes:
        raise ConnectionError("offline in tests")

    app.dependency_overrides[get_public_data_service] = lambda: PublicDataService(data, no_trips)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http
    app.dependency_overrides.pop(get_public_data_service, None)


async def test_incidents_sync_generalize_and_suppress_small_tracts(data, client, admin_conn):
    source, now = f"nibrs_{uuid4().hex[:6]}", datetime.now(UTC)
    tract = "55079" + uuid4().hex[:6]
    await data.sync(source, [ImportedArea(external_id=f"census_tract:{tract}", kind="census_tract", name="T1",
                                          geometry=SQUARE, min_lat=43.0, min_lon=-88.0, max_lat=43.1, max_lon=-87.9)],
                    now)
    rows = [ImportedIncident(external_id=f"C{i}", incident_at=now - timedelta(hours=i), latitude=43.012345,
                             longitude=-87.987654, offense_codes=["13A"], tract_geoid=tract) for i in range(5)]
    assert await data.sync(source, rows, now) == (5, 5)
    assert await data.sync(source, rows, now) == (5, 0)  # idempotent

    stored = await admin_conn.fetchrow("SELECT latitude, longitude FROM app.external_incidents WHERE source = $1",
                                       source)
    assert (stored["latitude"], stored["longitude"]) == (43.012, -87.988)

    points = (await client.get("/v1/public-data/incidents", params={"days": 1})).json()
    mine = [p for p in points if p["latitude"] == 43.01 and p["longitude"] == -87.99]
    assert len(mine) >= 5 and mine[0]["category"] == "assault"

    counts = {c["tract_geoid"]: c for c in (await client.get("/v1/public-data/incidents/by-tract",
                                                             params={"days": 1})).json()}
    assert counts[tract]["incidents"] == 5 and counts[tract]["tract_name"] == "T1"
    # Four is below the suppression threshold.
    await data.retire("external_incidents", source, now + timedelta(seconds=1), now - timedelta(minutes=30))
    remaining = {c["tract_geoid"] for c in (await client.get("/v1/public-data/incidents/by-tract",
                                                             params={"days": 1})).json()}
    assert tract not in remaining


async def test_calls_keep_their_status_history_and_hide_sensitive_and_expired_ones(data, client, admin_conn):
    source, now = "mpd_calls", datetime.now(UTC)
    tag = uuid4().hex[:6]

    def call(number, category, status, public=True, expires=timedelta(hours=1)):
        return ImportedSignal(external_id=f"P{tag}{number}", occurred_at=now, category=category, status=status,
                              latitude=43.04412, longitude=-87.92511, public=public, expires_at=now + expires)

    await data.sync(source, [call(1, "Shots Fired", "Assigned"), call(2, "Domestic Violence", "Assigned", False),
                             call(3, "Theft", "Assigned", expires=-timedelta(minutes=1))], now)
    await data.sync(source, [call(1, "Shots Fired", "Service in Progress")], now)

    history = await admin_conn.fetchval("SELECT statuses FROM app.external_signals WHERE external_id = $1",
                                        f"P{tag}1")
    assert history == ["Assigned", "Service in Progress"]
    listed = {c["call_number"]: c for c in (await client.get("/v1/public-data/calls")).json()}
    assert f"P{tag}1" in listed and f"P{tag}2" not in listed and f"P{tag}3" not in listed
    assert (listed[f"P{tag}1"]["latitude"], listed[f"P{tag}1"]["status"]) == (43.044, "Service in Progress")

    # Retiring calls removes the expired ones, not the ones the page stopped showing.
    assert await data.retire("external_signals", source, now + timedelta(hours=1)) >= 1
    left = await admin_conn.fetch("SELECT external_id FROM app.external_signals WHERE external_id LIKE $1",
                                  f"P{tag}%")
    assert {r["external_id"] for r in left} == {f"P{tag}1", f"P{tag}2"}


async def test_transit_near_a_place_and_weather_alerts(data, client):
    source, now = f"mcts_{uuid4().hex[:6]}", datetime.now(UTC)
    await data.sync(source, [
        ImportedTransitRoute(external_id="R30", short_name="30"),
        ImportedTransitStop(external_id="S66", name="WISCONSIN & JACKSON", latitude=43.0387653,
                            longitude=-87.9048367, routes=["R30"]),
        ImportedTransitStop(external_id="S99", name="FAR AWAY", latitude=43.2, longitude=-88.0, routes=["R30"]),
        ImportedTransitAlert(external_id="A1", header="30 Detour", routes=["R30"],
                             active_from=now - timedelta(hours=1)),
    ], now)
    await data.sync("nws_alerts", [ImportedWeatherAlert(external_id=f"urn:{uuid4().hex}", event="Heat Advisory",
                                                        expires_at=now + timedelta(hours=2))], now)

    nearby = (await client.get("/v1/public-data/transit/nearby",
                               params={"latitude": 43.0389, "longitude": -87.9065})).json()
    mine = [s for s in nearby["stops"] if s["stop_id"] == "S66"]
    assert mine and mine[0]["route_names"] == ["30"] and 100 < mine[0]["distance_m"] < 200
    assert "S99" not in {s["stop_id"] for s in nearby["stops"]}
    assert any(a["header"] == "30 Detour" for a in nearby["alerts"]) and nearby["arrivals_live"] is False
    assert "Not sponsored" in nearby["attribution"]
    assert any(a["event"] == "Heat Advisory" for a in (await client.get("/v1/public-data/weather-alerts")).json())

    # A run that no longer lists a stop removes it.
    assert await data.retire("transit_stops", source, now + timedelta(seconds=1)) == 2


async def test_runs_are_logged_and_the_latest_per_source_is_served(data, client):
    source = f"src_{uuid4().hex[:6]}"
    started = datetime.now(UTC)
    await data.record_run(source=source, target="incidents", status="ok", started_at=started, fetched=3,
                          written=3, retired=0, detail="")
    await data.record_run(source=source, target="incidents", status="failed", started_at=started, fetched=0,
                          written=0, retired=0, detail="fetch failed: timed out")
    (latest,) = [s for s in (await client.get("/v1/public-data/sources")).json() if s["source"] == source]
    assert latest["status"] == "failed" and latest["last_success_at"] is not None


async def test_only_public_data_tables_can_be_retired(data):
    with pytest.raises(Exception, match="Not a public data table"):
        await data.retire("users", "x", datetime.now(UTC))
