from fastapi import APIRouter, Depends

from dependencies import get_current_user, get_routing_service
from models.routing import RouteRequest, RouteResponse
from models.user import AppUser
from services.rout_request import RoutingService

router = APIRouter(prefix="/route", tags=["routing"])


@router.post("", response_model=RouteResponse)
async def route_request(
    body: RouteRequest,
    _: AppUser = Depends(get_current_user),
    service: RoutingService = Depends(get_routing_service),
) -> RouteResponse:
    """Picks the ComForce MKE service for a free-text request for help.
    Signed-in callers only, so the OpenAI key can't be spent by anyone."""
    return await service.route(body.message)
