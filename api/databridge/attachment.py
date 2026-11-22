from uuid import UUID

from databridge.base import Databridge
from models.attachment import Attachment, KnowledgeHit


class AttachmentDatabridge(Databridge):
    async def create(
        self, case_id: UUID, uploaded_by: UUID, file_name: str, content_type: str, size_bytes: int, note: str
    ) -> Attachment | None:
        """None: the case doesn't exist."""
        row = await self._first(
            "attachment_create",
            case_id=case_id, uploaded_by=uploaded_by, file_name=file_name, content_type=content_type,
            size_bytes=size_bytes, note=note,
        )
        return Attachment(**row) if row else None

    async def get(self, attachment_id: UUID) -> Attachment | None:
        row = await self._first("attachment_get", attachment_id=attachment_id)
        return Attachment(**row) if row else None

    async def list_for_case(self, case_id: UUID) -> list[Attachment]:
        return [Attachment(**row) for row in await self._rows("attachment_list", case_id=case_id)]

    async def mark_ready(self, attachment_id: UUID, size_bytes: int) -> Attachment | None:
        row = await self._first("attachment_mark_ready", attachment_id=attachment_id, size_bytes=size_bytes)
        return Attachment(**row) if row else None

    async def delete(self, attachment_id: UUID) -> None:
        await self._first("attachment_delete", attachment_id=attachment_id)

    async def search(self, query: str, limit: int) -> list[KnowledgeHit]:
        return [KnowledgeHit(**row) for row in await self._rows("knowledge_search", query=query, limit=limit)]
