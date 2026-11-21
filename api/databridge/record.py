from uuid import UUID

from databridge.base import Databridge
from models.record import Extraction, RecordSource, RecordStage, StoredRecord


class RecordDatabridge(Databridge):
    async def create(
        self, author_id: UUID, source: RecordSource, raw_text: str | None, stage: RecordStage
    ) -> StoredRecord:
        row = await self._one("record_create", author_id=author_id, source=source, raw_text=raw_text, stage=stage)
        return StoredRecord(**row)

    async def get(self, record_id: UUID) -> StoredRecord | None:
        row = await self._first("record_get", record_id=record_id)
        return StoredRecord(**row) if row else None

    async def list_by_author(self, author_id: UUID, limit: int) -> list[StoredRecord]:
        return [StoredRecord(**row) for row in await self._rows("record_list", author_id=author_id, limit=limit)]

    async def advance(
        self,
        record_id: UUID,
        next_stage: RecordStage,
        *,
        raw_text: str | None = None,
        redacted_text: str | None = None,
        extraction: Extraction | None = None,
    ) -> StoredRecord | None:
        """None: the record isn't processing any more (discarded meanwhile)."""
        row = await self._first(
            "record_advance",
            record_id=record_id, next_stage=next_stage, raw_text=raw_text, redacted_text=redacted_text,
            extraction=extraction.model_dump_json() if extraction else None,
        )
        return StoredRecord(**row) if row else None

    async def fail(self, record_id: UUID, error: str) -> StoredRecord | None:
        row = await self._first("record_fail", record_id=record_id, error=error)
        return StoredRecord(**row) if row else None

    async def fail_stalled(self, seconds: int) -> list[StoredRecord]:
        return [StoredRecord(**row) for row in await self._rows("record_fail_stalled", seconds=seconds)]

    async def retry(self, record_id: UUID) -> StoredRecord | None:
        row = await self._first("record_retry", record_id=record_id)
        return StoredRecord(**row) if row else None

    async def begin_confirm(self, record_id: UUID) -> StoredRecord | None:
        row = await self._first("record_begin_confirm", record_id=record_id)
        return StoredRecord(**row) if row else None

    async def finish_confirm(self, record_id: UUID, case_id: UUID) -> StoredRecord | None:
        row = await self._first("record_finish_confirm", record_id=record_id, case_id=case_id)
        return StoredRecord(**row) if row else None

    async def abort_confirm(self, record_id: UUID) -> None:
        await self._first("record_abort_confirm", record_id=record_id)

    async def discard(self, record_id: UUID) -> StoredRecord | None:
        row = await self._first("record_discard", record_id=record_id)
        return StoredRecord(**row) if row else None
