from datetime import UTC, datetime, timedelta
from uuid import uuid4

from models.case_enums import CaseCategory
from models.resource import Resource
from services.resource import fresh_beds

NOW = datetime(2026, 11, 21, 20, 0, tzinfo=UTC)


def shelter(beds: int | None, updated: datetime | None) -> Resource:
    return Resource(
        id=uuid4(), name="Shelter", category=CaseCategory.HOMELESSNESS, description="", is_sample=True,
        active=True, created_at=NOW, beds_available=beds, beds_updated_at=updated,
    )


def test_a_recent_bed_count_is_shown() -> None:
    resource = fresh_beds(shelter(12, NOW - timedelta(hours=3)), NOW)
    assert resource.beds_available == 12


def test_a_bed_count_older_than_a_day_reads_as_unknown() -> None:
    resource = fresh_beds(shelter(12, NOW - timedelta(hours=25)), NOW)
    assert resource.beds_available is None
    assert resource.beds_updated_at is None


def test_no_count_stays_unknown() -> None:
    assert fresh_beds(shelter(None, None), NOW).beds_available is None
