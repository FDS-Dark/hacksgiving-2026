from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import pytest

from models.public_data import WeatherAlert
from models.push import PushFacts
from adapters.push import apns_payload
from services.push_jobs import message_for
from services.weather_jobs import check_in_task, needs_shelter, wants_community_push, wants_outreach

NOW = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)


def alert(event: str, severity: str | None = "Moderate", **extra: Any) -> WeatherAlert:
    return WeatherAlert(id="urn:1", event=event, severity=severity, description="", **extra)


@pytest.mark.parametrize(
    "event", ["Extreme Cold Warning", "Wind Chill Advisory", "Winter Storm Warning", "Heat Advisory"]
)
def test_cold_and_heat_need_shelter(event: str):
    assert needs_shelter(alert(event))


@pytest.mark.parametrize("event", ["Wind Advisory", "Flood Watch", "Dense Fog Advisory"])
def test_other_weather_does_not(event: str):
    assert not needs_shelter(alert(event))


def test_outreach_is_for_cold_or_heat_at_moderate_or_worse():
    assert wants_outreach(alert("Wind Chill Advisory", "Moderate"))
    assert wants_outreach(alert("Extreme Cold Warning", "Extreme"))
    assert not wants_outreach(alert("Frost Advisory", "Minor"))
    assert not wants_outreach(alert("Tornado Warning", "Extreme"))


def test_residents_hear_about_serious_weather_and_shelter_weather():
    assert wants_community_push(alert("Tornado Warning", "Extreme"))
    assert wants_community_push(alert("Wind Chill Advisory", "Moderate"))
    assert not wants_community_push(alert("Wind Advisory", "Moderate"))
    assert not wants_community_push(alert("Frost Advisory", "Minor"))


def test_the_check_in_task_carries_the_alert_and_fits_the_columns():
    title, detail = check_in_task(alert("Extreme Cold Warning", headline="Wind chills near 30 below",
                                        instruction="Avoid going outside."))
    assert title == "Check in: Extreme Cold Warning"
    assert "Wind chills near 30 below" in detail and "Avoid going outside." in detail
    long_title, long_detail = check_in_task(alert("Cold " * 100, instruction="x" * 5000))
    assert len(long_title) <= 160 and len(long_detail) <= 2000


def test_a_community_alert_push_is_silent_and_names_nothing_but_the_weather():
    facts = PushFacts(
        id=uuid4(), user_id=uuid4(), kind="community_alert", case_id=None, created_at=NOW, read_at=None,
        expires_at=None, push_enabled=True, muted_kinds=[], quiet_start=None, quiet_end=None, timezone="UTC",
        reader_is_staff=False, unread_count=0, recent_push_count=0, last_case_push_at=None,
    )
    assert apns_payload(message_for(facts, NOW)) == {
        "aps": {"alert": {"title": "Weather alert", "body": "Open the app for details."},
                "interruption-level": "active", "thread-id": "updates"},
        "n": str(facts.id), "u": 0,
    }
