"""Small, auditable ElevenLabs boundary.

The adapter deliberately keeps provider secrets and provider-shaped payloads
out of the call service.  It also provides the webhook verifier used before a
post-call body is parsed.  Raw transcripts and audio are never returned by a
helper here; the API's webhook route decides which structured fields to keep.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import httpx


class ElevenLabsError(RuntimeError):
    """A safe provider error without response bodies or credentials."""


class TransferPolicyError(ValueError):
    """A transfer target violates the static safety policy."""


_E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
_BLOCKED_EMERGENCY_NUMBERS = frozenset({"911", "+1911", "988", "+1988"})


@dataclass(frozen=True, slots=True)
class TransferDestination:
    """One reviewed phone destination that may appear in the agent config."""

    key: str
    label: str
    phone_number: str
    condition: str
    enabled: bool = False

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", self.key):
            raise TransferPolicyError(
                "Destination key must be a plain snake-case identifier"
            )
        if self.phone_number in _BLOCKED_EMERGENCY_NUMBERS:
            raise TransferPolicyError(
                "Emergency short codes may never be configured as AI transfer targets"
            )
        if not _E164.fullmatch(self.phone_number):
            raise TransferPolicyError("Transfer phone numbers must use E.164 format")
        if not self.condition.strip():
            raise TransferPolicyError(
                "Every destination needs a narrow transfer condition"
            )


def transfer_tool(destinations: Sequence[TransferDestination]) -> dict[str, Any]:
    """Build the native-Twilio warm-transfer tool from an explicit allowlist."""
    enabled = [destination for destination in destinations if destination.enabled]
    if not enabled:
        raise TransferPolicyError(
            "At least one reviewed transfer destination must be enabled"
        )
    keys = [destination.key for destination in enabled]
    if len(keys) != len(set(keys)):
        raise TransferPolicyError("Transfer destination keys must be unique")
    numbers = [destination.phone_number for destination in enabled]
    if len(numbers) != len(set(numbers)):
        raise TransferPolicyError("Transfer destination phone numbers must be unique")

    transfers = [
        {
            "transfer_destination": {
                "type": "phone",
                "phone_number": destination.phone_number,
            },
            "condition": destination.condition,
            "transfer_type": "conference",
        }
        for destination in enabled
    ]
    return {
        "type": "system",
        "name": "transfer_to_number",
        "description": (
            "Warm-transfer only to a reviewed destination returned by the routing policy. "
            "Never transfer to 911, 988, or an unlisted number."
        ),
        "params": {
            "system_tool_type": "transfer_to_number",
            "transfers": transfers,
        },
    }


def build_agent_payload(
    *,
    prompt: str,
    destinations: Sequence[TransferDestination],
    tool_ids: Sequence[str] = (),
    name: str = "ComForce Community Response Navigator",
) -> dict[str, Any]:
    """Return a reviewable create-agent payload without embedding secrets."""
    return {
        "name": name,
        "tags": ["hacksgiving", "comforce", "milwaukee", "privacy-first"],
        "conversation_config": {
            "agent": {
                "first_message": (
                    "Hi, I'm an AI community resource navigator working with ComForce MKE. "
                    "If anyone is in immediate danger, please hang up and call 911 now. "
                    "Otherwise, how can I help?"
                ),
                "language": "en",
                "prompt": {
                    "prompt": prompt,
                    "tool_ids": list(tool_ids),
                    "built_in_tools": {
                        "transfer_to_number": transfer_tool(destinations),
                    },
                },
            },
        },
    }


class ElevenLabsClient:
    """Minimal provisioning client; normal call traffic does not pass here."""

    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = 20.0,
    ) -> None:
        if not api_key:
            raise ValueError("ElevenLabs API key is required")
        self._api_key = api_key
        self._transport = transport
        self._timeout = timeout_seconds

    async def _request(
        self, method: str, path: str, payload: Mapping[str, Any]
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(
            base_url="https://api.elevenlabs.io",
            headers={"xi-api-key": self._api_key, "Content-Type": "application/json"},
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            response = await client.request(
                method, path, content=json.dumps(payload)
            )
        if response.status_code >= 400:
            raise ElevenLabsError(
                f"ElevenLabs request failed with status {response.status_code}"
            )
        try:
            value = response.json()
        except ValueError:
            raise ElevenLabsError("ElevenLabs returned a non-JSON response")
        if not isinstance(value, dict):
            raise ElevenLabsError("ElevenLabs returned an unexpected response shape")
        return value

    async def _post(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        return await self._request("POST", path, payload)

    async def _patch(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", path, payload)

    async def create_agent(self, payload: Mapping[str, Any]) -> str:
        result = await self._post("/v1/convai/agents/create", payload)
        agent_id = result.get("agent_id")
        if not isinstance(agent_id, str) or not agent_id:
            raise ElevenLabsError("ElevenLabs response did not contain an agent id")
        return agent_id

    async def import_twilio_number(
        self,
        *,
        label: str,
        phone_number: str,
        account_sid: str,
        auth_token: str,
        agent_id: str | None = None,
    ) -> str:
        if not _E164.fullmatch(phone_number):
            raise ValueError("Twilio phone number must use E.164 format")
        payload = {
            "provider": "twilio",
            "label": label,
            "phone_number": phone_number,
            "sid": account_sid,
            "token": auth_token,
        }
        if agent_id is not None:
            if not agent_id.strip():
                raise ValueError("ElevenLabs agent id cannot be blank")
            payload["agent_id"] = agent_id
        result = await self._post(
            "/v1/convai/phone-numbers",
            payload,
        )
        phone_number_id = result.get("phone_number_id")
        if not isinstance(phone_number_id, str) or not phone_number_id:
            raise ElevenLabsError(
                "ElevenLabs response did not contain a phone number id"
            )
        return phone_number_id

    async def assign_phone_number(
        self,
        *,
        phone_number_id: str,
        agent_id: str,
        branch_id: str | None = None,
    ) -> str:
        """Assign an imported number to an agent without exposing provider data."""
        if not phone_number_id.strip():
            raise ValueError("ElevenLabs phone number id cannot be blank")
        if not agent_id.strip():
            raise ValueError("ElevenLabs agent id cannot be blank")
        payload = {"agent_id": agent_id}
        if branch_id is not None:
            if not branch_id.strip():
                raise ValueError("ElevenLabs branch id cannot be blank")
            payload["branch_id"] = branch_id
        result = await self._patch(
            f"/v1/convai/phone-numbers/{phone_number_id}", payload
        )
        assigned_id = result.get("phone_number_id")
        if not isinstance(assigned_id, str) or not assigned_id:
            raise ElevenLabsError(
                "ElevenLabs response did not contain a phone number id"
            )
        return assigned_id
