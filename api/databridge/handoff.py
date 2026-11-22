import json
from typing import Any
from uuid import UUID

from databridge.base import Databridge
from models.handoff import HandoffBrief, ShiftHandoff, SummarySource


def _handoff(row: dict[str, Any]) -> ShiftHandoff:
    brief = row["brief"]
    return ShiftHandoff(**(row | {"brief": json.loads(brief) if isinstance(brief, str) else brief}))


class HandoffDatabridge(Databridge):
    async def create(
        self, author_id: UUID, recipient_id: UUID | None, brief: HandoffBrief, summary: str
    ) -> ShiftHandoff:
        row = await self._one(
            "shift_handoff_create",
            author_id=author_id, recipient_id=recipient_id, brief=brief.model_dump_json(), summary=summary,
        )
        return _handoff(row)

    async def get(self, handoff_id: UUID) -> ShiftHandoff | None:
        row = await self._first("shift_handoff_get", handoff_id=handoff_id)
        return _handoff(row) if row else None

    async def list_for(self, user_id: UUID, days: int, limit: int) -> list[ShiftHandoff]:
        return [_handoff(r) for r in await self._rows("shift_handoff_list", user_id=user_id, days=days, limit=limit)]

    async def set_summary(self, handoff_id: UUID, summary: str, source: SummarySource) -> ShiftHandoff | None:
        row = await self._first("shift_handoff_set_summary", handoff_id=handoff_id, summary=summary, source=source)
        return _handoff(row) if row else None
