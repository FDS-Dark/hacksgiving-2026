import json
from datetime import datetime
from typing import Any
from uuid import UUID

from databridge.base import Databridge
from models.push import (
    ClaimedDelivery,
    DeliveryStatus,
    NotificationStats,
    PushDevice,
    PushEnvironment,
    PushFacts,
    PushPlatform,
    ReasonCount,
)


def _json(value: Any) -> Any:
    # asyncpg hands jsonb back as text unless a codec is set.
    return json.loads(value) if isinstance(value, str) else value


class PushDatabridge(Databridge):
    """Push devices and deliveries (database 0017)."""

    async def register(
        self,
        user_id: UUID,
        *,
        token: str,
        platform: PushPlatform,
        environment: PushEnvironment,
        app_version: str | None,
    ) -> PushDevice:
        row = await self._one(
            "push_device_register",
            user_id=user_id, token=token, platform=platform, environment=environment, app_version=app_version,
        )
        return PushDevice(**row)

    async def remove(self, user_id: UUID, token: str) -> bool:
        return await self._first("push_device_remove", user_id=user_id, token=token) is not None

    async def disable(self, device_id: UUID, reason: str) -> bool:
        return await self._first("push_device_disable", device_id=device_id, reason=reason) is not None

    async def list_active(self, user_id: UUID) -> list[PushDevice]:
        return [PushDevice(**row) for row in await self._rows("push_device_list_active", user_id=user_id)]

    async def prune_devices(self, days: int) -> int:
        return int((await self._one("push_device_prune", days=days))["deleted"])

    async def facts(self, notification_id: UUID) -> PushFacts | None:
        row = await self._first("notification_push_facts", notification_id=notification_id)
        return PushFacts(**row) if row else None

    async def chat_channel(self, notification_id: UUID) -> str | None:
        """team, oncall or case for a chat notification; None otherwise."""
        row = await self._first("chat_notification_channel", notification_id=notification_id)
        return str(row["channel"]) if row else None

    async def claim(self, notification_id: UUID) -> list[ClaimedDelivery]:
        """The deliveries to send now, already `sending` (committed by the
        executor's own transaction before any send)."""
        rows = await self._rows("notification_delivery_claim", notification_id=notification_id, skip_reason=None)
        return [ClaimedDelivery(**row) for row in rows]

    async def skip(self, notification_id: UUID, reason: str) -> None:
        """Nothing is sent: each active device's delivery is `skipped`, with why."""
        await self._rows("notification_delivery_claim", notification_id=notification_id, skip_reason=reason)

    async def record(
        self, delivery_id: UUID, status: DeliveryStatus, *, apns_id: str | None = None, reason: str | None = None
    ) -> bool:
        row = await self._first(
            "notification_delivery_record", delivery_id=delivery_id, status=status, apns_id=apns_id, reason=reason
        )
        return row is not None

    async def give_up(self, notification_id: UUID) -> int:
        return int((await self._one("notification_delivery_give_up", notification_id=notification_id))["updated"])

    async def prune_deliveries(self, days: int) -> int:
        return int((await self._one("notification_delivery_prune", days=days))["deleted"])

    async def stats(self, since: datetime) -> NotificationStats:
        row = await self._one("notification_stats", since=since)
        return NotificationStats(
            since=since,
            deliveries={DeliveryStatus(k): int(v) for k, v in (_json(row["deliveries"]) or {}).items()},
            active_devices=int(row["active_devices"]),
            disabled_devices=int(row["disabled_devices"]),
            top_reasons=[ReasonCount(**r) for r in _json(row["top_reasons"]) or []],
        )
