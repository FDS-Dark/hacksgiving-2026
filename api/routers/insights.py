"""Staff Insights with filters (`GET /v1/insights`): the numbers for a
period and police district, and the patterns spotted in them. The all-time
dashboard numbers stay at /v1/cases/insights."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_worker, get_insights_service
from models.insights import Insights
from models.staff import StaffMember
from services.insights import InsightsService

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("", response_model=Insights)
async def insights(
    _worker: Annotated[StaffMember, Depends(get_current_worker)],
    service: Annotated[InsightsService, Depends(get_insights_service)],
    days: Annotated[int, Query(ge=1, le=365, description="The period: this many days up to now.")] = 30,
    district: Annotated[str | None, Query(max_length=8, description="A police district key, from `districts`.")]
    = None,
) -> Insights:
    """Cases opened in the period (in one police district, when given), by
    need, and the patterns among them. Staff only."""
    return await service.overview(days, district or None)
