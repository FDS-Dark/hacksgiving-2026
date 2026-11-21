"""The data loader's sync functions (0012_data_loader.sql) against real
PostgreSQL, as the app role: imports insert, update and close; duplicates of
open rows (staff postings included) are skipped; staff decisions stick; and
the app lists imports next to staff postings."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from databridge.opportunity import OpportunityDatabridge
from databridge.resource import ResourceDatabridge
from loader.runner import opportunity_fingerprint, resource_fingerprint, run
from loader.sources import Source, Target
from models.case_enums import CaseCategory
from models.loader import ImportedOpportunity, ImportedResource, SyncResult
from models.opportunity import Audience, OpportunityKind
from settings import LoaderConfig
from tests.helpers import auth_header
from tests.integration.conftest import app_executor


@pytest.fixture
async def executor(database):
    executor = app_executor(database)
    yield executor
    await executor.dispose()


@pytest.fixture
def opportunities(executor):
    return OpportunityDatabridge(executor)


@pytest.fixture
def resources(executor):
    return ResourceDatabridge(executor)


@pytest.fixture
async def people(api, admin_conn):
    worker, member = auth_header(f"auth0|{uuid4().hex}", name="Wes Worker"), auth_header(f"auth0|{uuid4().hex}")
    worker_id = (await api.get("/v1/me", headers=worker)).json()["id"]
    await api.get("/v1/me", headers=member)
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    return {"worker": worker, "member": member}


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


async def test_duplicates_of_open_rows_are_skipped_staff_postings_included(api, people, opportunities, admin_conn):
    tag = uuid4().hex[:8]
    now = datetime.now(UTC)
    staff = await api.post("/v1/opportunities", headers=people["worker"], json={
        "kind": "job", "title": f"Line Cook {tag}", "organization": "Northside Kitchen", "location": "Milwaukee",
        "audiences": ["second_chance"],
    })
    assert staff.status_code == 201

    # The same posting from a source: case, punctuation and the state don't matter.
    same = job("careeronestop_jobs", f"b-{tag}", f"line cook {tag}!", organization="NORTHSIDE KITCHEN",
               location="Milwaukee, Wisconsin")
    assert await opportunities.sync_upsert(same, now) is SyncResult.DUPLICATE
    assert await _row(admin_conn, "careeronestop_jobs", f"b-{tag}") is None

    # And across sources: the first source keeps it.
    usa = job("usajobs", f"c-{tag}", f"Dishwasher {tag}")
    nlx = job("careeronestop_jobs", f"d-{tag}", f"Dishwasher {tag}")
    assert await opportunities.sync_upsert(usa, now) is SyncResult.INSERTED
    assert await opportunities.sync_upsert(nlx, now) is SyncResult.DUPLICATE

    # Once the staff posting is closed, an import of the same job can come in.
    await api.patch(f"/v1/opportunities/{staff.json()['id']}", headers=people["worker"], json={"active": False})
    assert await opportunities.sync_upsert(same, now) is SyncResult.INSERTED


async def test_a_posting_staff_close_stays_closed_until_they_reopen_it(api, people, opportunities, admin_conn):
    tag = uuid4().hex[:8]
    now = datetime.now(UTC)
    item = job("usajobs", f"e-{tag}", f"Driver {tag}")
    await opportunities.sync_upsert(item, now)
    row = await _row(admin_conn, "usajobs", f"e-{tag}")

    closed = await api.patch(f"/v1/opportunities/{row['id']}", headers=people["worker"], json={"active": False})
    assert closed.json()["active"] is False
    await opportunities.sync_upsert(item.model_copy(update={"pay": "$20/hour"}), now + timedelta(hours=1))
    assert not (await _row(admin_conn, "usajobs", f"e-{tag}"))["active"]

    await api.patch(f"/v1/opportunities/{row['id']}", headers=people["worker"], json={"active": True})
    assert await opportunities.sync_upsert(item, now + timedelta(hours=2)) is SyncResult.UPDATED
    assert (await _row(admin_conn, "usajobs", f"e-{tag}"))["active"]


async def test_residents_see_imports_after_staff_postings_and_can_filter(api, people, opportunities):
    tag = uuid4().hex[:8]
    now = datetime.now(UTC)
    await api.post("/v1/opportunities", headers=people["worker"], json={
        "kind": "job", "title": f"Warehouse {tag}", "organization": "Second Start Co", "audiences": ["second_chance"],
    })
    await api.post("/v1/opportunities", headers=people["worker"], json={
        "kind": "education", "title": f"GED class {tag}", "organization": "Central Library", "cost": "free",
    })
    await opportunities.sync_upsert(job("usajobs", f"f-{tag}", f"Mail clerk {tag}",
                                        posted_at=now - timedelta(days=1)), now)
    # Past its closing date: hidden even before the loader closes it.
    await opportunities.sync_upsert(job("usajobs", f"g-{tag}", f"Expired clerk {tag}",
                                        expires_at=now - timedelta(minutes=1)), now)

    member = people["member"]
    listed = (await api.get("/v1/opportunities", headers=member, params={"q": tag})).json()
    assert [o["title"] for o in listed][-1] == f"Mail clerk {tag}"
    assert {o["source"] for o in listed[:2]} == {"manual"} and len(listed) == 3
    education = next(o for o in listed if o["kind"] == "education")
    assert education["cost"] == "free"

    second_chance = (await api.get("/v1/opportunities", headers=member,
                                   params={"q": tag, "audience": "second_chance"})).json()
    assert [o["title"] for o in second_chance] == [f"Warehouse {tag}"]
    imported = (await api.get("/v1/opportunities", headers=member, params={"q": tag, "origin": "imported"})).json()
    assert [o["title"] for o in imported] == [f"Mail clerk {tag}"]
    limited = (await api.get("/v1/opportunities", headers=member, params={"q": tag, "limit": 1})).json()
    assert len(limited) == 1


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


async def test_a_full_run_through_the_runner(opportunities, resources, admin_conn):
    tag = uuid4().hex[:8]

    async def fetch(_):
        return [job("usajobs", f"k-{tag}", f"Runner job {tag}")]

    (report,) = await run([Source("usajobs", Target.OPPORTUNITIES, "test", lambda _: None, fetch)], LoaderConfig(),
                          opportunities=opportunities, resources=resources)
    assert report.results["inserted"] == 1
    assert (await _row(admin_conn, "usajobs", f"k-{tag}"))["active"]


async def test_staff_rows_cant_be_synced(opportunities):
    with pytest.raises(Exception, match="not synced"):
        await opportunities.sync_upsert(job("manual", "x", "Nope"), datetime.now(UTC))
