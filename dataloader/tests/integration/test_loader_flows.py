"""The loader against real PostgreSQL, as the app role: its databridges call
the stored functions with the arguments they take (0013, 0014, 0030),
imports insert, update and close, duplicates of open rows are skipped, the
Python fingerprints match the database's, and the run log feeds the rate
gate. api/tests/integration/test_imported_opportunity_flows.py covers how
the API lists imports next to staff postings."""

import os
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest

from client import comforce
from client.errors import RateLimited
from databridge.loader_run import LoaderRunDatabridge
from databridge.opportunity import OpportunityDatabridge
from databridge.public_data import TABLES, PublicDataDatabridge
from databridge.resource import ResourceDatabridge
from loader.base import RunContext, Status, Target, opportunity_fingerprint, resource_fingerprint, run_all
from model.enums import Audience, CaseCategory, OpportunityKind
from model.imported import ImportedOpportunity, ImportedResource, SyncResult
from model.public_data import (
    ImportedArea,
    ImportedCommunityMeasure,
    ImportedCrimeTrend,
    ImportedIncident,
    ImportedSignal,
    ImportedTransitAlert,
    ImportedTransitRoute,
    ImportedTransitStop,
    ImportedWeatherAlert,
)
from settings import LoaderConfig
from tests.fakes import make_loader


@pytest.fixture
def opportunities(executor):
    return OpportunityDatabridge(executor)


@pytest.fixture
def resources(executor):
    return ResourceDatabridge(executor)


@pytest.fixture
def public_data(executor):
    return PublicDataDatabridge(executor)


@pytest.fixture
def runs(executor):
    return LoaderRunDatabridge(executor)


def job(source: str, external_id: str, title: str, **fields) -> ImportedOpportunity:
    return ImportedOpportunity(source=source, external_id=external_id, kind=OpportunityKind.JOB, title=title,
                               organization=fields.pop("organization", "Northside Kitchen"),
                               location=fields.pop("location", "Milwaukee, WI"), **fields)


async def _row(admin_conn, source: str, external_id: str):
    return await admin_conn.fetchrow(
        "SELECT * FROM app.opportunities WHERE source = $1 AND external_id = $2", source, external_id)


async def test_an_import_inserts_then_updates_then_is_closed_when_the_source_drops_it(opportunities, admin_conn):
    tag = uuid4().hex[:8]
    first, later = datetime.now(UTC), datetime.now(UTC) + timedelta(hours=1)

    item = job("usajobs", f"a-{tag}", f"Clerk {tag}", pay="$17/hour", audiences=[Audience.NO_EXPERIENCE])
    assert await opportunities.sync_upsert(item, first) is SyncResult.INSERTED
    assert await opportunities.sync_upsert(item, first) is SyncResult.UNCHANGED
    changed = item.model_copy(update={"pay": "$18/hour"})
    assert await opportunities.sync_upsert(changed, later) is SyncResult.UPDATED

    row = await _row(admin_conn, "usajobs", f"a-{tag}")
    assert row["pay"] == "$18/hour" and row["audiences"] == ["no_experience"] and row["active"]
    assert row["last_seen_at"] == later and row["created_by"] is None

    # A run that no longer lists it closes it; a later one that does reopens it.
    assert await opportunities.sync_retire("usajobs", later + timedelta(hours=1)) >= 1
    assert not (await _row(admin_conn, "usajobs", f"a-{tag}"))["active"]
    assert await opportunities.sync_upsert(changed, later + timedelta(hours=2)) is SyncResult.UPDATED
    assert (await _row(admin_conn, "usajobs", f"a-{tag}"))["active"]


async def test_the_first_source_keeps_a_posting_two_sources_list(opportunities):
    tag = uuid4().hex[:8]
    now = datetime.now(UTC)
    usa = job("usajobs", f"c-{tag}", f"Dishwasher {tag}")
    # Case, punctuation and the state don't matter.
    nlx = job("careeronestop_jobs", f"d-{tag}", f"DISHWASHER {tag}!", location="Milwaukee, Wisconsin")
    assert await opportunities.sync_upsert(usa, now) is SyncResult.INSERTED
    assert await opportunities.sync_upsert(nlx, now) is SyncResult.DUPLICATE


async def test_resources_sync_and_never_count_samples_as_duplicates(resources, admin_conn):
    tag = uuid4().hex[:8]
    now = datetime.now(UTC)
    center = ImportedResource(source="careeronestop_ajc", external_id=f"h-{tag}", name=f"Job Center {tag}",
                              category=CaseCategory.BRIDGE_TO_EMPLOYMENT, latitude=43.09, longitude=-87.94)
    assert await resources.sync_upsert(center, now) is SyncResult.INSERTED
    assert await resources.sync_upsert(center, now) is SyncResult.UNCHANGED
    same = center.model_copy(update={"source": "careeronestop_reentry", "external_id": f"i-{tag}",
                                     "name": f"JOB CENTER {tag}."})
    assert await resources.sync_upsert(same, now) is SyncResult.DUPLICATE

    # A (Sample) row with the same name doesn't block a real listing.
    sample = ImportedResource(source="careeronestop_reentry", external_id=f"j-{tag}",
                              name="Second Chance Jobs Center (Sample)", category=CaseCategory.BRIDGE_TO_EMPLOYMENT)
    assert await resources.sync_upsert(sample, now) is SyncResult.INSERTED

    assert await resources.sync_retire("careeronestop_ajc", now + timedelta(seconds=1)) >= 1
    row = await admin_conn.fetchrow("SELECT * FROM app.resources WHERE external_id = $1", f"h-{tag}")
    assert row["active"] is False and row["latitude"] == 43.09


async def test_the_python_fingerprints_match_the_database(admin_conn):
    item = job("usajobs", "x", "Line Cook (Part-Time) #2", organization="St. Ann's", location="Milwaukee , WI")
    sql = await admin_conn.fetchval("SELECT app.opportunity_fingerprint('job', $1, $2, $3)",
                                    item.title, item.organization, item.location)
    assert sql == opportunity_fingerprint(item)
    place = ImportedResource(source="a", external_id="x", name="ATTIC Services - Milwaukee",
                             category=CaseCategory.OTHER)
    assert await admin_conn.fetchval("SELECT app.resource_fingerprint($1)", place.name) == resource_fingerprint(place)


async def test_staff_rows_cant_be_synced(opportunities):
    with pytest.raises(Exception, match="not synced"):
        await opportunities.sync_upsert(job("manual", "x", "Nope"), datetime.now(UTC))


async def test_a_full_run_through_the_loader(opportunities, resources, runs, admin_conn):
    tag = uuid4().hex[:8]
    source = make_loader("usajobs", [job("usajobs", f"k-{tag}", f"Runner job {tag}")])

    (report,) = await run_all([source], RunContext(LoaderConfig(), opportunities=opportunities,
                                                   resources=resources, runs=runs))

    assert report.status is Status.OK and report.results["inserted"] == 1
    assert (await _row(admin_conn, "usajobs", f"k-{tag}"))["active"]
    logged = await admin_conn.fetchrow(
        "SELECT * FROM app.loader_runs WHERE source = 'usajobs' ORDER BY id DESC LIMIT 1")
    assert logged["status"] == "ok" and logged["written"] == 1 and logged["rate_limited"] is False


async def test_calls_are_tagged_with_the_tract_the_boundaries_source_loaded(public_data, admin_conn):
    now = datetime.now(UTC)
    square = {"type": "Polygon",
              "coordinates": [[[-88.0, 43.0], [-87.9, 43.0], [-87.9, 43.1], [-88.0, 43.1], [-88.0, 43.0]]]}
    tract = ImportedArea(external_id="census_tract:55079999900", kind="census_tract", name="9999",
                         geometry=square, min_lat=43.0, min_lon=-88.0, max_lat=43.1, max_lon=-87.9)
    boundaries = make_loader("mke_boundaries", [tract], target=Target.AREAS, tables=("geo_areas",))
    call = ImportedSignal(external_id=f"P{uuid4().int % 10**9}", occurred_at=now, category="Theft", public=True,
                          latitude=43.05, longitude=-87.95, expires_at=now + timedelta(hours=24))
    calls = make_loader("mfd_calls", [call], target=Target.SIGNALS, tables=("external_signals",),
                        empty_is_valid=True)

    reports = await run_all([boundaries, calls], RunContext(LoaderConfig(), public_data=public_data))

    assert [r.status for r in reports] == [Status.OK, Status.OK]
    row = await admin_conn.fetchrow("SELECT * FROM app.external_signals WHERE external_id = $1", call.external_id)
    assert row["tract_geoid"] == "55079999900"


async def test_every_imported_row_type_syncs_and_retires(public_data, admin_conn):
    """Each model in TABLES against its <table>_sync function: the columns
    the JSON carries are the ones the function reads."""
    source, now = f"all_{uuid4().hex[:6]}", datetime.now(UTC)
    rows = [
        ImportedArea(external_id="neighborhood:T1", kind="neighborhood", name="Test Park",
                     geometry={"type": "Polygon", "coordinates": [[[-88.0, 43.0], [-87.9, 43.0], [-87.9, 43.1],
                                                                   [-88.0, 43.0]]]},
                     min_lat=43.0, min_lon=-88.0, max_lat=43.1, max_lon=-87.9),
        ImportedIncident(external_id="C1", incident_at=now, latitude=43.012345, longitude=-87.987654,
                         offense_codes=["13A"], weapons=["40"]),
        ImportedSignal(external_id="P1", occurred_at=now, category="Theft", public=True,
                       expires_at=now + timedelta(hours=24)),
        ImportedTransitRoute(external_id="R30", short_name="30", color="008556"),
        ImportedTransitStop(external_id="S66", name="WISCONSIN & JACKSON", latitude=43.04, longitude=-87.9,
                            routes=["R30"]),
        ImportedTransitAlert(external_id="A1", header="30 Detour", routes=["R30"], active_from=now),
        ImportedWeatherAlert(external_id="urn:1", event="Heat Advisory", expires_at=now + timedelta(hours=2)),
        ImportedCommunityMeasure(external_id="55079000100:FOODINSECU:2023", tract_geoid="55079000100",
                                 measure_id="FOODINSECU", measure="Food insecurity", year=2023, value=18.5),
        ImportedCrimeTrend(external_id="homicide:actual:mpd:2026-10", offense="homicide", measure="actual",
                           series="mpd", month=date(2026, 10, 1), value=12),
    ]
    assert set(TABLES) == {type(r) for r in rows}

    assert await public_data.sync(source, rows, now) == (len(rows), len(rows))
    assert await public_data.sync(source, rows, now) == (len(rows), 0)  # idempotent
    for row_type, (_, table) in TABLES.items():
        count = await admin_conn.fetchval(f"SELECT count(*) FROM app.{table} WHERE source = $1", source)
        assert count == 1, (row_type.__name__, table)

    later = now + timedelta(seconds=1)
    retired = [await public_data.retire(t, source, later, now - timedelta(days=1)) for _, t in TABLES.values()]
    assert retired[1] == 1  # the incident, within its window


async def test_main_runs_a_source_end_to_end_and_records_it(app_env, admin_conn):
    """`python main.py --source ...` as the CronJob runs it: settings from
    the environment, the dependencies' engine, the run recorded. The
    ComForce source asks no server."""
    result = subprocess.run([sys.executable, "main.py", "--source", comforce.SOURCE],
                            cwd=Path(__file__).resolve().parents[2], env={**os.environ, **app_env},
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    assert "comforce_reviewed: ok" in result.stderr
    assert await admin_conn.fetchval(
        "SELECT status FROM app.loader_runs WHERE source = 'comforce_reviewed' ORDER BY id DESC LIMIT 1") == "ok"
    assert await admin_conn.fetchval(
        "SELECT count(*) FROM app.resources WHERE source = 'comforce_reviewed' AND active") == 3


async def test_the_run_log_tells_the_gate_about_attempts_and_rate_limits(runs, admin_conn):
    source = f"gate_{uuid4().hex[:8]}"
    assert (await runs.gate(source)).last_attempt_at is None

    start = datetime.now(UTC) - timedelta(minutes=40)
    await runs.record_run(source=source, target="signals", status="failed", started_at=start, fetched=0, written=0,
                          retired=0, detail="rate limited: too many", rate_limited=True)
    await runs.record_run(source=source, target="signals", status="ok", started_at=start + timedelta(minutes=35),
                          fetched=3, written=3, retired=0, detail="", rate_limited=False)
    await runs.record_run(source=source, target="signals", status="skipped",
                          started_at=start + timedelta(minutes=39), fetched=0, written=0, retired=0,
                          detail="needs a key", rate_limited=False)

    state = await runs.gate(source)
    # A skip isn't an attempt.
    assert state.last_attempt_at == start + timedelta(minutes=35)
    assert state.last_rate_limited_at == start
    (health,) = [h for h in await runs.source_health() if h.source == source]
    assert health.status == "skipped" and health.last_success_at is not None


async def test_an_older_loader_still_records_runs_without_the_rate_limit_flag(executor, admin_conn):
    """loader_run_record's new argument is optional (0030), so the loader
    that's deployed while the migration runs keeps working."""
    source = f"old_{uuid4().hex[:8]}"
    await executor.call("loader_run_record", {
        "source": source, "target": "signals", "status": "ok", "started_at": datetime.now(UTC), "fetched": 1,
        "written": 1, "retired": 0, "detail": ""})
    assert await admin_conn.fetchval("SELECT rate_limited FROM app.loader_runs WHERE source = $1", source) is False


async def test_a_rate_limited_source_is_held_back_by_another_loader_on_the_same_database(runs, public_data):
    """Two loaders, one database: the second one doesn't ask MPD again
    after the first one was refused."""
    name = f"mpd_{uuid4().hex[:8]}"
    limited = make_loader(name, target=Target.SIGNALS, error=RateLimited("10 requests per 30 minutes"),
                          min_interval=timedelta(minutes=5))
    (first,) = await run_all([limited], RunContext(LoaderConfig(), public_data=public_data, runs=runs))
    assert first.status is Status.FAILED and first.rate_limited

    other = make_loader(name, target=Target.SIGNALS, min_interval=timedelta(minutes=5))
    later = datetime.now(UTC) + timedelta(minutes=10)
    (second,) = await run_all([other], RunContext(LoaderConfig(), public_data=public_data, runs=runs,
                                                  clock=lambda: later))
    assert second.status is Status.SKIPPED and "backing off" in second.detail
