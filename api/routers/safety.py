"""Public safety data the resident app maps: recent Milwaukee Police
Department calls for service, ingested every five minutes by the API's
background loop (services/mpd_scheduler.py)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user, get_mpd_call_service
from models.safety import MpdCalls
from models.user import AppUser
from services.mpd_calls import MpdCallService

router = APIRouter(prefix="/safety", tags=["safety"])


@router.get("/calls", response_model=MpdCalls)
async def recent_calls(
    hours: Annotated[int, Query(ge=1, le=72, description="How far back to look, by dispatch time.")] = 6,
    _: AppUser = Depends(get_current_user),
    service: MpdCallService = Depends(get_mpd_call_service),
) -> MpdCalls:
    """MPD calls for service dispatched in the last `hours`, newest first,
    with counts by category, call type, district and hour. Locations are
    generalized: a block or intersection and coordinates rounded to about
    110 m. Calls are delayed 30-90 minutes by MPD and are not confirmed
    crimes."""
    return await service.recent(hours)
