import json

import httpx
import pytest

from adapters.elevenlabs import (
    ElevenLabsClient,
    ElevenLabsError,
    TransferDestination,
    TransferPolicyError,
    build_agent_payload,
    transfer_tool,
)


@pytest.mark.parametrize("number", ["911", "+1911", "988", "+1988"])
def test_emergency_short_codes_can_never_be_transfer_targets(number: str):
    with pytest.raises(TransferPolicyError, match="Emergency"):
        TransferDestination("emergency", "Emergency", number, "Anything")


def test_transfer_config_contains_only_enabled_reviewed_destinations():
    approved = TransferDestination(
        "comforce_demo",
        "ComForce demo responder",
        "+14145550100",
        "Only after the caller requests a ComForce responder and no immediate danger is present.",
        enabled=True,
    )
    disabled = TransferDestination(
        "police_non_emergency",
        "MPD non-emergency",
        "+14149334444",
        "Only for a non-emergency police report.",
    )

    tool = transfer_tool([approved, disabled])

    assert tool["params"]["transfers"] == [
        {
            "transfer_destination": {"type": "phone", "phone_number": "+14145550100"},
            "condition": approved.condition,
            "transfer_type": "conference",
        }
    ]


def test_agent_payload_carries_tool_ids_and_emergency_disclosure():
    destination = TransferDestination(
        "comforce_demo",
        "ComForce demo responder",
        "+14145550100",
        "Caller asks for the approved demo responder.",
        enabled=True,
    )
    payload = build_agent_payload(
        prompt="Follow the safety gate.",
        destinations=[destination],
        tool_ids=["tool_lookup"],
    )

    agent = payload["conversation_config"]["agent"]
    assert "call 911" in agent["first_message"]
    assert agent["prompt"]["tool_ids"] == ["tool_lookup"]


@pytest.mark.asyncio
async def test_provisioning_client_never_exposes_provider_response_on_error():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["xi-api-key"] == "test-key"
        return httpx.Response(401, json={"detail": "secret provider internals"})

    client = ElevenLabsClient("test-key", transport=httpx.MockTransport(handler))

    with pytest.raises(ElevenLabsError, match="status 401") as failure:
        await client.create_agent({"conversation_config": {}})
    assert "provider internals" not in str(failure.value)


@pytest.mark.asyncio
async def test_twilio_import_posts_provider_payload():
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"phone_number_id": "phnum_123"})

    client = ElevenLabsClient("test-key", transport=httpx.MockTransport(handler))
    result = await client.import_twilio_number(
        label="ComForce demo",
        phone_number="+14145550100",
        account_sid="AC_test",
        auth_token="token_test",
    )

    assert result == "phnum_123"
    assert captured == {
        "provider": "twilio",
        "label": "ComForce demo",
        "phone_number": "+14145550100",
        "sid": "AC_test",
        "token": "token_test",
    }


@pytest.mark.asyncio
async def test_twilio_import_can_assign_agent_during_setup():
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"phone_number_id": "phnum_123"})

    client = ElevenLabsClient("test-key", transport=httpx.MockTransport(handler))
    result = await client.import_twilio_number(
        label="ComForce demo",
        phone_number="+14145550100",
        account_sid="AC_test",
        auth_token="token_test",
        agent_id="agent_123",
    )

    assert result == "phnum_123"
    assert captured["agent_id"] == "agent_123"


@pytest.mark.asyncio
async def test_phone_number_assignment_uses_patch_and_supports_branch():
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["payload"] = json.loads(request.content)
        return httpx.Response(200, json={"phone_number_id": "phnum_123"})

    client = ElevenLabsClient("test-key", transport=httpx.MockTransport(handler))
    result = await client.assign_phone_number(
        phone_number_id="phnum_123",
        agent_id="agent_123",
        branch_id="branch_123",
    )

    assert result == "phnum_123"
    assert captured == {
        "method": "PATCH",
        "path": "/v1/convai/phone-numbers/phnum_123",
        "payload": {"agent_id": "agent_123", "branch_id": "branch_123"},
    }
