"""Partners, case shares, texts to requesters and need versus coverage
(0021_partners_and_outreach.sql) against real PostgreSQL, as the app role."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from databridge.insights import InsightsDatabridge
from databridge.partner import PartnerDatabridge
from databridge.text import TextDatabridge
from models.partner import ConsentMethod, PartnerBody
from tests.integration.conftest import app_executor


@pytest.fixture
async def executor(database):
    executor = app_executor(database)
    yield executor
    await executor.dispose()


async def new_case(admin_conn, **fields: object) -> UUID:
    columns = {"title": "Test", "category": "homelessness", "source": "public"} | fields
    names = ", ".join(columns)
    marks = ", ".join(f"${i}" for i in range(1, len(columns) + 1))
    return await admin_conn.fetchval(f"INSERT INTO app.cases ({names}) VALUES ({marks}) RETURNING id",
                                     *columns.values())


async def test_a_partner_is_shared_with_once_until_revoked(executor, admin_conn):
    partners = PartnerDatabridge(executor)
    worker = await admin_conn.fetchval(
        "INSERT INTO app.users (auth0_sub, display_name, role) VALUES ($1, 'Wes', 'worker') RETURNING id",
        f"test|{uuid4()}")
    open_door = await partners.create(PartnerBody(name="Harbor House", categories=["homelessness"],
                                                  accepts_shares=True), worker)
    closed = await partners.create(PartnerBody(name="No MOU yet"), worker)
    case_id = await new_case(admin_conn)

    def share(partner_id: UUID):
        return partners.share(case_id=case_id, partner_id=partner_id, shared_by=worker, purpose="Bed tonight",
                              include_contact=False, include_location=True, consent_method=ConsentMethod.VERBAL,
                              consent_note=None)

    first = await share(open_door.id)
    assert first is not None and first.partner_name == "Harbor House" and first.shared_by_name == "Wes"
    assert await share(open_door.id) is None  # one live share per partner
    assert await share(closed.id) is None  # hasn't agreed to receive shares

    revoked = await partners.revoke(case_id, first.id, worker)
    assert revoked is not None and revoked.revoked_by_name == "Wes"
    assert await partners.revoke(case_id, first.id, worker) is None
    assert await share(open_door.id) is not None  # can be shared again after revoking
    assert [s.revoked_at is None for s in await partners.shares(case_id)] == [True, False]

    found = await partners.search("harbor", None, False)
    assert open_door.id in {p.id for p in found}
    assert open_door.id in {p.id for p in await partners.search(None, "homelessness", False)}  # type: ignore[arg-type]


async def test_only_consented_text_updates_are_pending_and_each_once(executor, admin_conn):
    texts = TextDatabridge(executor)
    yes = await new_case(admin_conn, contact_phone="414-555-0199", contact_method="text", safe_to_contact=True)
    unsafe = await new_case(admin_conn, contact_phone="414-555-0198", contact_method="text", safe_to_contact=False)
    calls = await new_case(admin_conn, contact_phone="414-555-0197", contact_method="call", safe_to_contact=True)
    worker = await admin_conn.fetchval(
        "INSERT INTO app.users (auth0_sub, display_name, role) VALUES ($1, 'Wes', 'worker') RETURNING id",
        f"test|{uuid4()}")
    for case_id in (yes, unsafe, calls):
        await admin_conn.execute(
            "INSERT INTO app.case_updates (case_id, author_id, update_type, visibility, content) VALUES "
            "($1, $2, 'message', 'public', 'On our way'), ($1, $2, 'note', 'internal', 'private')",
            case_id, worker)

    pending = [p for p in await texts.pending(200) if p.case_id in (yes, unsafe, calls)]
    assert [(p.case_id, p.update_type) for p in pending] == [(yes, "message")]

    (item,) = pending
    assert await texts.record(yes, item.case_update_id, "sent", None, "SM1") is not None
    assert await texts.record(yes, item.case_update_id, "sent", None, "SM2") is None
    assert all(p.case_update_id != item.case_update_id for p in await texts.pending(200))
    assert [t.provider_id for t in await texts.for_case(yes)] == ["SM1"]


async def test_coverage_counts_matching_cases_and_suppresses_small_incident_counts(executor, admin_conn):
    geoid = "55079" + uuid4().hex[:6]
    await admin_conn.execute(
        "INSERT INTO app.geo_areas (source, external_id, kind, name, properties, geometry, min_lat, min_lon, "
        "max_lat, max_lon, last_seen_at) VALUES ('t', $1, 'census_tract', 'T1', $2, '{}', 43.0, -88.0, 43.1, "
        "-87.9, now())", f"census_tract:{geoid}", '{"INTPTLAT": "+43.0612345", "INTPTLON": "-087.9512345"}')
    await admin_conn.execute(
        "INSERT INTO app.community_measures (source, external_id, tract_geoid, measure_id, measure, year, value, "
        "last_seen_at) VALUES ('t', $1, $2, 'HOUSINSECU', 'Housing insecurity', 2023, 31.5, now()), "
        "('t', $3, $2, 'HOUSINSECU', 'Housing insecurity', 2022, 20.0, now())",
        f"{geoid}|H|2023", geoid, f"{geoid}|H|2022")
    for category in ("homelessness", "homelessness", "meal_programs"):
        case_id = await new_case(admin_conn, category=category)
        await admin_conn.execute(
            "INSERT INTO app.case_places (case_id, status, source, latitude, longitude, tract_geoid) "
            "VALUES ($1, 'placed', 'case', 43.06, -87.95, $2)", case_id, geoid)
    for n in range(3):
        await admin_conn.execute(
            "INSERT INTO app.external_incidents (source, external_id, incident_at, tract_geoid, last_seen_at) "
            "VALUES ('t', $1, now() - interval '1 day', $2, now())", f"{geoid}-{n}", geoid)

    end = datetime.now(UTC) + timedelta(minutes=1)
    rows = await InsightsDatabridge(executor).coverage("HOUSINSECU", "homelessness", end - timedelta(days=30), end)
    (row,) = [r for r in rows if r["tract_geoid"] == geoid]
    assert (row["need"], row["need_year"], row["cases"], row["incidents"]) == (31.5, 2023, 2, None)
    assert (row["latitude"], row["longitude"]) == (43.061, -87.951)
