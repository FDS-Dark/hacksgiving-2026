"""MPD call ingestion against real PostgreSQL: a scrape is upserted by call
number, the geocode cache spares repeat lookups, and GET /v1/safety/calls
returns the generalized calls with their summary."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest

from databridge.mpd_call import MpdCallDatabridge
from dependencies import get_mpd_call_service
from main import app
from services.mpd_calls import MILWAUKEE_TZ, MpdCallService
from tests.helpers import auth_header
from tests.integration.conftest import app_executor


def _page(rows):
    cells = "".join(
        "<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows
    )
    return f"<table><tbody>{cells}</tbody></table>"


class Page:
    def __init__(self, html):
        self.html = html

    async def fetch_calls_page(self):
        return self.html


class Geocoder:
    def __init__(self):
        self.asked = []

    async def geocode(self, address):
        self.asked.append(address)
        return (43.0389, -87.9065) if "GREELEY" in address else None


@pytest.fixture
async def service(database):
    executor = app_executor(database)
    svc = MpdCallService(MpdCallDatabridge(executor))
    app.dependency_overrides[get_mpd_call_service] = lambda: svc
    yield svc
    app.dependency_overrides.pop(get_mpd_call_service, None)
    await executor.dispose()


async def test_ingest_upserts_and_the_api_serves_generalized_calls(api, service, admin_conn):
    digits = f"{uuid4().int % 10**9:09d}"
    first, second = f"P{digits}1", f"P{digits}2"
    when = (datetime.now(MILWAUKEE_TZ) - timedelta(minutes=40)).strftime("%m/%d/%Y %I:%M %p")
    rows = [
        (first, when, "2816 S GREELEY ST MKE", "6", "Shooting", "Service in Progress"),
        (second, when, "INT 43 S", "CITY", "Traffic Stop", "Service in Progress"),
    ]
    geocoder = Geocoder()

    result = await service.ingest(Page(_page(rows)), geocoder)
    assert (result.rows_seen, result.new_calls, result.mapped) == (2, 2, 1)

    # Second sighting: the status changes, nothing is new, and neither address is looked up again.
    rows[0] = rows[0][:5] + ("Report Taken",)
    again = await service.ingest(Page(_page(rows)), geocoder)
    assert again.new_calls == 0
    assert sorted(geocoder.asked) == ["2816 S GREELEY ST", "INT 43 S"]

    stored = await admin_conn.fetchrow("SELECT * FROM app.mpd_calls WHERE call_number = $1", first)
    assert stored["status"] == "Report Taken" and stored["latitude"] == 43.039

    member = auth_header(f"auth0|{uuid4().hex}")
    response = await api.get("/v1/safety/calls", headers=member, params={"hours": 3})
    assert response.status_code == 200
    body = response.json()
    mine = {c["call_number"]: c for c in body["calls"] if c["call_number"] in (first, second)}
    assert mine[first]["block"] == "2800 block of S GREELEY ST"
    assert mine[first]["category"] == "weapons"
    assert "location" not in mine[first]
    assert mine[second]["latitude"] is None
    assert body["stale"] is False and body["summary"]["total"] >= 2

    assert (await api.get("/v1/safety/calls")).status_code == 401
    assert (await api.get("/v1/safety/calls", headers=member, params={"hours": 999})).status_code == 422


async def test_a_failed_run_is_recorded(service, admin_conn):
    with pytest.raises(ValueError):
        await service.ingest(Page("<html>down</html>"), Geocoder())
    run = await admin_conn.fetchrow("SELECT * FROM app.mpd_ingest_runs ORDER BY id DESC LIMIT 1")
    assert run["ok"] is False and "zero calls" in run["error"]
