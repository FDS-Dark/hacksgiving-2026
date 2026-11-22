"""Routing with OpenAI's Decisions API, against a fake endpoint: typed
answers become the same RouteResponse, urgent is flagged generously, an
unsure answer asks instead, and any failure falls back to the Responses
router."""

import json

import httpx
import pytest

from errors import ApiError
from models.routing import RouteResponse, Service
from services.routing_decisions import DecisionsRoutingService, to_route


def answers(choice: str, probs: dict[str, float], urgent: float) -> list[dict]:
    return [
        {"type": "choice", "name": "service", "choice": choice, "confidence": probs.get(choice, 0),
         "probabilities": [{"value": k, "probability": v} for k, v in probs.items()]},
        {"type": "predicate", "name": "urgent", "probability": urgent},
    ]


class Fallback:
    def __init__(self) -> None:
        self.asked: list[str] = []

    async def route(self, message: str) -> RouteResponse:
        self.asked.append(message)
        return RouteResponse(service=Service.MEAL_PROGRAMS, urgent=False, reason="from the fallback")


def service_with(handler, fallback=None):
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return DecisionsRoutingService("sk-test", fallback=fallback, http=http)


def test_answers_become_a_route_with_runners_up():
    r = to_route(answers("violence_prevention", {"violence_prevention": 0.7, "transportation": 0.25,
                                                 "meal_programs": 0.05}, urgent=0.9))
    assert r.service == Service.VIOLENCE_PREVENTION and r.urgent is True
    assert r.also_relevant == [Service.TRANSPORTATION]
    assert "violence prevention" in r.reason and "May be urgent" in r.reason
    assert r.follow_up_question is None


def test_urgent_is_flagged_generously():
    assert to_route(answers("meal_programs", {"meal_programs": 0.9}, urgent=0.36)).urgent is True
    assert to_route(answers("meal_programs", {"meal_programs": 0.9}, urgent=0.2)).urgent is False


def test_an_unsure_answer_asks_instead():
    r = to_route(answers("homelessness", {"homelessness": 0.3, "meal_programs": 0.28, "unclear": 0.2}, urgent=0.1))
    assert r.service == Service.UNCLEAR and r.follow_up_question
    assert r.also_relevant == [Service.HOMELESSNESS, Service.MEAL_PROGRAMS]


def test_a_refused_question_is_not_a_route():
    with pytest.raises(ValueError):
        to_route([{"type": "refusal", "name": "service"}, {"type": "predicate", "name": "urgent", "probability": 0}])


async def test_the_request_asks_two_typed_questions_and_counts_cost():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        assert request.url.path == "/v1/decisions" and request.headers["Authorization"] == "Bearer sk-test"
        return httpx.Response(200, json={
            "model": "gpt-6-luna",
            "answers": answers("transportation", {"transportation": 0.92}, urgent=0.05),
            "usage": {"input_tokens": 1800, "output_tokens": 0, "total_tokens": 1800},
        })

    router = service_with(handler)
    r = await router.route("need a ride to court tomorrow")
    assert r.service == Service.TRANSPORTATION and r.urgent is False
    (body,) = seen
    assert body["model"] == "gpt-6-luna" and body["input"] == "need a ride to court tomorrow"
    assert [q["name"] for q in body["questions"]] == ["service", "urgent"]
    assert {c["value"] for c in body["questions"][0]["choices"]} == {s.value for s in Service}
    assert router.last_usage and router.last_usage.usd == pytest.approx(0.00018)


async def test_failures_fall_back_to_the_responses_router():
    fallback = Fallback()
    refused = service_with(lambda r: httpx.Response(200, json={"answers": [{"type": "refusal", "name": "service"}]}),
                           fallback)
    assert (await refused.route("hi")).reason == "from the fallback"
    down = service_with(lambda r: httpx.Response(503, json={"error": "overloaded"}), fallback)
    assert (await down.route("hi again")).reason == "from the fallback"
    assert fallback.asked == ["hi", "hi again"]

    # Without a fallback, a failure is a 502 like the Responses router's.
    with pytest.raises(ApiError) as e:
        await service_with(lambda r: httpx.Response(500)).route("x")
    assert e.value.status_code == 502
