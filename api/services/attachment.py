"""Case attachments and knowledge search (feature 29).

Attachments: the phone asks for a one-time upload URL (the file goes
straight to the private object store, never through the API), PUTs the
file, then says it's done; the API checks it arrived and isn't larger than
promised, marks it ready, and notes it on the case history. Opening one is
a short-lived signed link. Without object storage configured, attachments
are off (503) and everything else works.

Knowledge search needs no storage and no AI: full-text search in Postgres."""

import logging
from uuid import UUID

from adapters.storage import ATTACHMENT_TYPES, AudioStorage
from databridge.attachment import AttachmentDatabridge
from errors import ApiError, not_found
from models.attachment import (
    MAX_ATTACHMENT_BYTES,
    Attachment,
    AttachmentLink,
    AttachmentStatus,
    AttachmentUpload,
    KnowledgeHit,
    StartAttachmentRequest,
)
from models.case import AddCaseUpdateRequest, Visibility
from models.staff import StaffMember
from services.case import CaseService

logger = logging.getLogger(__name__)

PREFIX = "attachments/"
UPLOAD_SECONDS = 540
LINK_SECONDS = 300


def attachment_key(case_id: UUID, attachment_id: UUID) -> str:
    return f"{PREFIX}{case_id}/{attachment_id}"


class AttachmentService:
    def __init__(self, attachments: AttachmentDatabridge, cases: CaseService, storage: AudioStorage | None) -> None:
        self.attachments = attachments
        self.cases = cases
        self.storage = storage

    def _storage(self) -> AudioStorage:
        if self.storage is None:
            raise ApiError(503, "attachments_unavailable", "File storage isn't set up on this server")
        return self.storage

    async def start(self, worker: StaffMember, case_id: UUID, body: StartAttachmentRequest) -> AttachmentUpload:
        storage = self._storage()
        content_type = body.content_type.strip().lower()
        if content_type not in ATTACHMENT_TYPES:
            raise ApiError(415, "unsupported_type", "Attach a photo (JPEG, PNG, HEIC) or a PDF")
        attachment = await self.attachments.create(
            case_id, worker.id, body.file_name, content_type, body.size_bytes, body.note
        )
        if attachment is None:
            raise not_found("case")
        return AttachmentUpload(
            attachment=attachment,
            upload_url=await storage.upload_url(attachment_key(case_id, attachment.id), content_type),
            content_type=content_type,
            expires_in_seconds=UPLOAD_SECONDS,
        )

    async def uploaded(self, worker: StaffMember, case_id: UUID, attachment_id: UUID) -> Attachment:
        """Check the file arrived, then mark it ready and note it on the case.
        A repeat call returns it unchanged."""
        storage = self._storage()
        attachment = await self._own_case(case_id, attachment_id)
        if attachment.status == AttachmentStatus.READY:
            return attachment
        stored = await storage.head(attachment_key(case_id, attachment_id))
        if stored is None:
            raise ApiError(409, "file_not_uploaded", "The file hasn't arrived yet; upload it, then try again")
        if stored.size > MAX_ATTACHMENT_BYTES:
            await storage.delete(attachment_key(case_id, attachment_id))
            await self.attachments.delete(attachment_id)
            raise ApiError(413, "file_too_large", "Files can be up to 10 MB")
        ready = await self.attachments.mark_ready(attachment_id, stored.size)
        if ready is None:
            return await self._own_case(case_id, attachment_id)
        note = f"Attached {ready.file_name}" + (f": {ready.note}" if ready.note else ".")
        await self.cases.add_update(worker, case_id, AddCaseUpdateRequest(content=note, visibility=Visibility.INTERNAL))
        return ready

    async def for_case(self, case_id: UUID) -> list[Attachment]:
        await self.cases.get(case_id)
        return await self.attachments.list_for_case(case_id)

    async def link(self, case_id: UUID, attachment_id: UUID) -> AttachmentLink:
        storage = self._storage()
        attachment = await self._own_case(case_id, attachment_id)
        if attachment.status != AttachmentStatus.READY:
            raise ApiError(409, "file_not_uploaded", "This file hasn't finished uploading")
        url = await storage.download_url(attachment_key(case_id, attachment_id), LINK_SECONDS)
        return AttachmentLink(url=url, expires_in_seconds=LINK_SECONDS)

    async def delete(self, case_id: UUID, attachment_id: UUID) -> None:
        await self._own_case(case_id, attachment_id)
        if self.storage is not None:
            try:
                await self.storage.delete(attachment_key(case_id, attachment_id))
            except Exception:
                logger.warning("Couldn't delete the file of attachment %s", attachment_id)
        await self.attachments.delete(attachment_id)

    async def search(self, query: str, limit: int = 30) -> list[KnowledgeHit]:
        query = query.strip()
        if len(query) < 2:
            return []
        return await self.attachments.search(query, limit)

    async def _own_case(self, case_id: UUID, attachment_id: UUID) -> Attachment:
        attachment = await self.attachments.get(attachment_id)
        if attachment is None or attachment.case_id != case_id:
            raise not_found("attachment")
        return attachment
