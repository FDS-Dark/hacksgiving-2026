"""Imported opportunities next to staff postings, through the API: an import
that duplicates an open staff posting is skipped, a posting staff close
stays closed, and residents see imports after staff postings and can
filter them. The imports go in the way the data loader writes them
(app.opportunity_sync_upsert, 0013_data_loader.sql); the loader's own tests
are in dataloader/tests."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from tests.helpers import auth_header
from tests.integration.conftest import app_executor


@pytest.fixture
async def executor(database):
    executor = app_executor(database)
    yield executor
    await executor.dispose()


class Imports:
    """Writes imports the way the data loader does."""

    def __init__(self, executor) -> None:
        self.executor = executor

    async def sync_upsert(self, item: dict, seen_at: datetime) -> str:
        (row,) = await self.executor.call("opportunity_sync_upsert", {
            "kind": "job", "organization": "Northside Kitchen", "location": "Milwaukee, WI", "description": "",
            "schedule": None, "pay": None, "contact_phone": None, "contact_email": None, "apply_url": None,
            "audiences": [], "cost": None, "posted_at": None, "expires_at": None, **item, "seen_at": seen_at,
        })
        return row["result"]


@pytest.fixture
def opportunities(executor):
    return Imports(executor)


@pytest.fixture
async def people(api, admin_conn):
    worker, member = auth_header(f"auth0|{uuid4().hex}", name="Wes Worker"), auth_header(f"auth0|{uuid4().hex}")
    worker_id = (await api.get("/v1/me", headers=worker)).json()["id"]
    await api.get("/v1/me", headers=member)
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    return {"worker": worker, "member": member}


def job(source: str, external_id: str, title: str, **fields) -> dict:
    return {"source": source, "external_id": external_id, "title": title, **fields}


async def _row(admin_conn, source: str, external_id: str):
    return await admin_conn.fetchrow(
        "SELECT * FROM app.opportunities WHERE source = $1 AND external_id = $2", source, external_id)


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
    assert await opportunities.sync_upsert(same, now) == "duplicate"
    assert await _row(admin_conn, "careeronestop_jobs", f"b-{tag}") is None

    # And across sources: the first source keeps it.
    usa = job("usajobs", f"c-{tag}", f"Dishwasher {tag}")
    nlx = job("careeronestop_jobs", f"d-{tag}", f"Dishwasher {tag}")
    assert await opportunities.sync_upsert(usa, now) == "inserted"
    assert await opportunities.sync_upsert(nlx, now) == "duplicate"

    # Once the staff posting is closed, an import of the same job can come in.
    await api.patch(f"/v1/opportunities/{staff.json()['id']}", headers=people["worker"], json={"active": False})
    assert await opportunities.sync_upsert(same, now) == "inserted"


async def test_a_posting_staff_close_stays_closed_until_they_reopen_it(api, people, opportunities, admin_conn):
    tag = uuid4().hex[:8]
    now = datetime.now(UTC)
    item = job("usajobs", f"e-{tag}", f"Driver {tag}")
    await opportunities.sync_upsert(item, now)
    row = await _row(admin_conn, "usajobs", f"e-{tag}")

    closed = await api.patch(f"/v1/opportunities/{row['id']}", headers=people["worker"], json={"active": False})
    assert closed.json()["active"] is False
    await opportunities.sync_upsert({**item, "pay": "$20/hour"}, now + timedelta(hours=1))
    assert not (await _row(admin_conn, "usajobs", f"e-{tag}"))["active"]

    await api.patch(f"/v1/opportunities/{row['id']}", headers=people["worker"], json={"active": True})
    assert await opportunities.sync_upsert(item, now + timedelta(hours=2)) == "updated"
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
