"""Case attachments (photos and PDFs on a case) and knowledge search across
what the team already knows. ComForce staff only."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from dependencies import get_attachment_service, get_current_worker
from models.attachment import Attachment, AttachmentLink, AttachmentUpload, KnowledgeHit, StartAttachmentRequest
from models.staff import StaffMember
from services.attachment import AttachmentService

router = APIRouter(tags=["attachments"])


@router.post("/cases/{case_id}/attachments", response_model=AttachmentUpload, status_code=status.HTTP_201_CREATED)
async def start_attachment(
    case_id: UUID,
    body: StartAttachmentRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: AttachmentService = Depends(get_attachment_service),
) -> AttachmentUpload:
    """Attach a photo or PDF (up to 10 MB): returns a one-time URL to PUT the
    file to. Then call `.../uploaded`. 503 when file storage isn't set up."""
    return await service.start(worker, case_id, body)


@router.post("/cases/{case_id}/attachments/{attachment_id}/uploaded", response_model=Attachment)
async def attachment_uploaded(
    case_id: UUID,
    attachment_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: AttachmentService = Depends(get_attachment_service),
) -> Attachment:
    """The file is uploaded: it's checked, marked ready and noted on the case."""
    return await service.uploaded(worker, case_id, attachment_id)


@router.get("/cases/{case_id}/attachments", response_model=list[Attachment])
async def list_attachments(
    case_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: AttachmentService = Depends(get_attachment_service),
) -> list[Attachment]:
    return await service.for_case(case_id)


@router.get("/cases/{case_id}/attachments/{attachment_id}/link", response_model=AttachmentLink)
async def attachment_link(
    case_id: UUID,
    attachment_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: AttachmentService = Depends(get_attachment_service),
) -> AttachmentLink:
    """A link that opens the file for five minutes."""
    return await service.link(case_id, attachment_id)


@router.delete("/cases/{case_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    case_id: UUID,
    attachment_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: AttachmentService = Depends(get_attachment_service),
) -> Response:
    await service.delete(case_id, attachment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/knowledge/search", response_model=list[KnowledgeHit])
async def knowledge_search(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    _: StaffMember = Depends(get_current_worker),
    service: AttachmentService = Depends(get_attachment_service),
) -> list[KnowledgeHit]:
    """Search what the team knows: the resource directory, resolved and
    closed cases, the internal notes on them, and attachment notes. Best
    matches first; matching words in `snippet` are wrapped in « »."""
    return await service.search(q)
