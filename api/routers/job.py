"""Background jobs: queue health for admins (stuck or dead work shows here)."""

from fastapi import APIRouter, Depends

from dependencies import get_current_admin, get_job_service
from models.job import JobStat
from models.staff import StaffMember
from services.job import JobService

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/stats", response_model=list[JobStat])
async def job_stats(
    _: StaffMember = Depends(get_current_admin),
    service: JobService = Depends(get_job_service),
) -> list[JobStat]:
    """Jobs by kind and status: everything queued, running or dead, and what
    finished in the last day. `oldest_run_at` on queued work shows a backlog."""
    return await service.stats()
