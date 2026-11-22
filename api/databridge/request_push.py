from uuid import UUID

from databridge.base import Databridge
from models.push import RequestPushTarget


class RequestPushDatabridge(Databridge):
    """Phones subscribed to a request sent without an account."""

    async def subscribe(
        self, number: int, code_hash: bytes, token: str, platform: str, environment: str
    ) -> UUID | None:
        row = await self._first(
            "request_push_subscribe", number=number, code_hash=code_hash, token=token, platform=platform,
            environment=environment,
        )
        return row["case_id"] if row else None

    async def unsubscribe(self, number: int, code_hash: bytes, token: str) -> int:
        row = await self._one("request_push_unsubscribe", number=number, code_hash=code_hash, token=token)
        return int(row["removed"])

    async def targets(self, case_id: UUID) -> list[RequestPushTarget]:
        return [RequestPushTarget(**row) for row in await self._rows("request_push_targets", case_id=case_id)]

    async def disable(self, subscription_id: UUID, reason: str) -> None:
        await self._rows("request_push_disable", id=subscription_id, reason=reason)
