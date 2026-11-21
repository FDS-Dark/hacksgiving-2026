from datetime import UTC, datetime
from uuid import uuid4

import pytest

from databridge.community import CommunityDatabridge
from services.community import CommunityService
from tests.unit.fakes import FakeFunctions

NOW = datetime.now(UTC)


def resource_row(**changes: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": uuid4(),
        "slug": "impact-211",
        "name": "IMPACT 211",
        "category": "basic-needs",
        "description": "Housing, food and health navigation.",
        "phone_e164": None,
        "website_url": "https://city.milwaukee.gov/not911",
        "address_label": None,
        "latitude": None,
        "longitude": None,
        "languages": ["en", "es"],
        "service_area": "Milwaukee",
        "hours_label": "24/7",
        "is_emergency": False,
        "last_verified_at": NOW,
    }
    row.update(changes)
    return row


@pytest.mark.asyncio
async def test_assistant_returns_catalog_matches_without_private_data() -> None:
    functions = FakeFunctions(public_resource_search=[resource_row()])
    service = CommunityService(CommunityDatabridge(functions))

    answer = await service.answer("I need food tonight")

    assert answer.resources[0].name == "IMPACT 211"
    assert "IMPACT 211" in answer.answer
    assert functions.called("public_resource_search") == [{"query": "I need food tonight", "category": None}]


@pytest.mark.asyncio
async def test_assistant_redirects_immediate_danger_to_911() -> None:
    functions = FakeFunctions(public_resource_search=[])
    service = CommunityService(CommunityDatabridge(functions))

    answer = await service.answer("There is immediate danger and a weapon")

    assert answer.emergency is True
    assert "911" in answer.answer


@pytest.mark.asyncio
async def test_requests_are_scoped_to_verified_user() -> None:
    user_id = uuid4()
    created = {
        "id": uuid4(),
        "category": "Housing",
        "summary": "Need short-term shelter navigation",
        "neighborhood": "South Side",
        "contact_preference": "in-app",
        "status": "submitted",
        "created_at": NOW,
    }
    functions = FakeFunctions(assistance_request_create=[created])
    service = CommunityService(CommunityDatabridge(functions))

    result = await service.create_request(user_id, "Housing", str(created["summary"]), "South Side", "in-app")

    assert result.status == "submitted"
    assert functions.called("assistance_request_create")[0]["user_id"] == user_id
