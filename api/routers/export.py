"""`GET /v1/me/export`: a worker's own records as one CSV (staff Me →
"Export my records")."""

from typing import Annotated

from fastapi import APIRouter, Depends

from dependencies import get_current_worker, get_export_service
from models.export import RecordsExport
from models.staff import StaffMember
from services.export import ExportService

router = APIRouter(tags=["export"])


@router.get("/me/export", response_model=RecordsExport)
async def export_my_records(
    worker: Annotated[StaffMember, Depends(get_current_worker)],
    service: Annotated[ExportService, Depends(get_export_service)],
) -> RecordsExport:
    """Your debriefs (summary and fields, never the text or audio), the cases
    assigned to or opened by you, the tasks you completed and the referral
    outcomes you confirmed, with a summary at the top. Only your own; never
    a resident's phone, email or name."""
    return await service.mine(worker)
