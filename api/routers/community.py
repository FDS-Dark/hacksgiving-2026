"""Community alerts (Figma R5, resident Me): whether this person gets a push
for serious Milwaukee weather alerts. Off until they turn it on."""

from fastapi import APIRouter, Depends

from dependencies import get_community_service, get_current_user
from models.community import CommunityAlerts
from models.user import AppUser
from services.community import CommunityService

router = APIRouter(prefix="/me/community-alerts", tags=["community alerts"])


@router.get("", response_model=CommunityAlerts)
async def get_community_alerts(
    user: AppUser = Depends(get_current_user),
    service: CommunityService = Depends(get_community_service),
) -> CommunityAlerts:
    return await service.alerts(user)


@router.put("", response_model=CommunityAlerts)
async def set_community_alerts(
    body: CommunityAlerts,
    user: AppUser = Depends(get_current_user),
    service: CommunityService = Depends(get_community_service),
) -> CommunityAlerts:
    """Turn community alerts on or off. Pushes still follow the person's
    push switch and quiet hours."""
    return await service.set_alerts(user, body.subscribed)
