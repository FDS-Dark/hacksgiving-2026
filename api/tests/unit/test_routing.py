from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from dependencies import get_routing_service, get_user_service
from main import app
from models.routing import Routing, Service
from services.rout_request import RoutingService, build_instructions
from tests.helpers import auth_header


class FakeResponses:
    def __init__(self, routing: Routing | None = None, error: Exception | None = None):
        self.routing = routing
        self.error = error
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(output_parsed=self.routing)


def service(fake: Any) -> RoutingService:
    return RoutingService(fake, "test-model")


def routing(**overrides) -> Routing:
    fields = dict(
        service=Service.MEAL_PROGRAMS,
        also_relevant=[],
        urgent=False,
        reason="They have no food at home.",
        follow_up_question=None,
    )
    return Routing(**{**fields, **overrides})


def test_every_service_is_described_to_the_model():
    instructions = build_instructions()
    for each in Service:
        assert f"- {each.value}:" in instructions


async def test_sends_the_message_and_returns_the_routing():
    fake = FakeResponses(routing())
    result = await service(fake).route("my kids havent eaten since yesterday")

    assert result.service == Service.MEAL_PROGRAMS
    call = fake.calls[0]
    assert call["model"] == "test-model"
    assert call["input"] == "my kids havent eaten since yesterday"
    assert call["text_format"] is Routing


async def test_also_relevant_drops_the_primary_unclear_and_repeats():
    fake = FakeResponses(routing(
        service=Service.VIOLENCE_PREVENTION,
        also_relevant=[Service.TRANSPORTATION, Service.VIOLENCE_PREVENTION, Service.UNCLEAR, Service.TRANSPORTATION],
    ))
    result = await service(fake).route("someone shot at my house and i need to get out")
    assert result.also_relevant == [Service.TRANSPORTATION]


async def test_follow_up_question_only_when_unclear():
    fake = FakeResponses(routing(follow_up_question="What do you need?"))
    assert (await service(fake).route("food")).follow_up_question is None

    fake = FakeResponses(routing(service=Service.UNCLEAR, follow_up_question="What do you need help with?"))
    assert (await service(fake).route("help")).follow_up_question == "What do you need help with?"


@pytest.mark.parametrize("fake", [FakeResponses(error=RuntimeError("boom")), FakeResponses(routing=None)])
def test_openai_failure_is_a_structured_502(sample_user, fake):
    app.dependency_overrides[get_user_service] = lambda: _users(sample_user)
    app.dependency_overrides[get_routing_service] = lambda: service(fake)
    try:
        response = TestClient(app).post("/v1/route", json={"message": "help"}, headers=auth_header())
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 502
    assert response.json()["code"] == "routing_unavailable"


def test_route_endpoint(sample_user):
    app.dependency_overrides[get_user_service] = lambda: _users(sample_user)
    fake = FakeResponses(routing(service=Service.BURIAL_ASSISTANCE))
    app.dependency_overrides[get_routing_service] = lambda: service(fake)
    try:
        client = TestClient(app)
        assert client.post("/v1/route", json={"message": "x"}).status_code == 401
        assert client.post("/v1/route", json={"message": "  "}, headers=auth_header()).status_code == 422
        response = client.post(
            "/v1/route", json={"message": "my grandma passed and we cant afford a funeral"}, headers=auth_header()
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["service"] == "burial_assistance"


def _users(user):
    class Users:
        async def get_or_create(self, claims):
            return user

    return Users()
