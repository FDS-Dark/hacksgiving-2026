"""Texts to requesters (0021_partners_and_outreach.sql, case_texts)."""

from uuid import UUID

from databridge.base import Databridge
from models.text import CaseText, PendingText


class TextDatabridge(Databridge):
    async def pending(self, limit: int) -> list[PendingText]:
        return [PendingText(**row) for row in await self._rows("case_text_pending", limit=limit)]

    async def record(self, case_id: UUID, case_update_id: UUID, status: str, reason: str | None,
                     provider_id: str | None) -> CaseText | None:
        row = await self._first("case_text_record", case_id=case_id, case_update_id=case_update_id,
                                status=status, reason=reason, provider_id=provider_id)
        return CaseText(**row) if row else None

    async def for_case(self, case_id: UUID) -> list[CaseText]:
        return [CaseText(**row) for row in await self._rows("case_text_list", case_id=case_id)]
