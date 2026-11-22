"""Case places and Insights (0020_case_places.sql) against real PostgreSQL,
as the app role: a case is pending until placed and again when its
location changes, points are rounded, and patterns, totals and the
district filter count the right cases. The cases are dated 2001 so other
tests' cases never fall in the period."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from databridge.insights import InsightsDatabridge
from databridge.place import PlaceDatabridge
from databridge.public_data import PublicDataDatabridge
from models.place import CasePlace, PendingPlace, PlaceSource, PlaceStatus
from models.public_data import ImportedArea
from services.insights import InsightsService
from tests.integration.conftest import app_executor

NOW = datetime(2001, 6, 30, 12, tzinfo=UTC)


@pytest.fixture
async def executor(database):
    executor = app_executor(database)
    yield executor
    await executor.dispose()


async def new_case(admin_conn, location: str | None, category: str = "other") -> UUID:
    return await admin_conn.fetchval(
        "INSERT INTO app.cases (title, category, source, location) VALUES ('Test', $1, 'public', $2) RETURNING id",
        category, location)


async def test_a_case_is_pending_until_placed_and_again_once_its_location_changes(executor, admin_conn):
    places = PlaceDatabridge(executor)
    case_id = await new_case(admin_conn, "27th and Center")

    pending = {p.case_id: p for p in await places.pending(500)}
    assert pending[case_id].location == "27th and Center"

    place = CasePlace(case_id=case_id, status=PlaceStatus.PLACED, source=PlaceSource.GEOCODER,
                      latitude=43.067908, longitude=-87.947391, label="N 27th St & W Center St",
                      police_district="3")
    saved = await places.save(place, pending[case_id])
    assert saved is not None and (saved.latitude, saved.longitude) == (43.068, -87.947)
    assert case_id not in {p.case_id for p in await places.pending(500)}

    await admin_conn.execute("UPDATE app.cases SET location = '35th and Lisbon' WHERE id = $1", case_id)
    assert case_id in {p.case_id for p in await places.pending(500)}

    gone = CasePlace(case_id=uuid4(), status=PlaceStatus.UNPLACED)
    assert await places.save(gone, PendingPlace(case_id=gone.case_id)) is None


async def test_patterns_totals_and_the_district_filter(executor, admin_conn):
    district, hood = "T" + uuid4().hex[:5], "TESTHOOD " + uuid4().hex[:6].upper()
    await PublicDataDatabridge(executor).sync("test_areas", [ImportedArea(
        external_id=f"police_district:{district}", kind="police_district", name=district,
        geometry={"type": "Polygon", "coordinates": [[[-87.85, 42.85], [-87.8, 42.85], [-87.8, 42.9],
                                                      [-87.85, 42.9], [-87.85, 42.85]]]},
        min_lat=42.85, min_lon=-87.85, max_lat=42.9, max_lon=-87.8)], NOW)
    places = PlaceDatabridge(executor)

    async def placed(when: str, category: str, lat: float, lon: float) -> None:
        case_id = await new_case(admin_conn, "somewhere", category)
        await admin_conn.execute("UPDATE app.cases SET created_at = $2 WHERE id = $1", case_id,
                                 datetime.fromisoformat(when))
        await places.save(CasePlace(case_id=case_id, status=PlaceStatus.PLACED, source=PlaceSource.GEOCODER,
                                    latitude=lat, longitude=lon, label="N 1st St & W Test Ave",
                                    police_district=district, neighborhood=hood), PendingPlace(case_id=case_id))

    # One corner: Friday 11 PM and Saturday 1 AM (Chicago, CDT), a Wednesday
    # noon, and one the month before.
    await placed("2001-06-30T04:00:00+00:00", "violence_prevention", 42.871, -87.821)
    await placed("2001-06-30T06:00:00+00:00", "violence_prevention", 42.871, -87.821)
    await placed("2001-06-27T17:00:00+00:00", "other", 42.871, -87.821)
    await placed("2001-05-20T17:00:00+00:00", "other", 42.871, -87.821)
    # Elsewhere in the same neighborhood.
    for day in (10, 11, 12):
        await placed(f"2001-06-{day}T17:00:00+00:00", "meal_programs", 42.88 + day / 1000, -87.83)

    service = InsightsService(InsightsDatabridge(executor), "America/Chicago")
    result = await service.overview(30, district, now=NOW)

    assert result.totals.opened == 6 and result.totals.placed == 6
    by_need = {c.category: c.total for c in result.by_category}
    assert by_need == {"violence_prevention": 2, "other": 1, "meal_programs": 3}
    spot, area = result.patterns
    assert (spot.kind, spot.total, spot.prior_total) == ("spot", 3, 1)
    assert (spot.weekend_night_total, spot.night_total, spot.top_category) == (2, 2, "violence_prevention")
    assert spot.headline == "3 requests near N 1st St & W Test Ave"
    assert spot.detail.startswith("2 on weekend nights · mostly violence prevention · up from 1")
    assert len(spot.case_ids) == 3
    assert (area.kind, area.total, area.prior_total) == ("neighborhood", 6, 1)
    assert district in {d.key for d in result.districts}

    other = await service.overview(30, "no-such-district", now=NOW)
    assert other.totals.opened == 0 and other.patterns == []
