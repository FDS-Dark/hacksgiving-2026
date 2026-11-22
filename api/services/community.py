"""Community alerts (Figma R5): residents opt in to a push when the National
Weather Service issues a serious alert for Milwaukee. Off by default; the
sending is the worker's (services/weather_jobs.py)."""

from databridge.community import CommunityDatabridge
from models.community import CommunityAlerts
from models.user import AppUser


class CommunityService:
    def __init__(self, community: CommunityDatabridge) -> None:
        self.community = community

    async def alerts(self, user: AppUser) -> CommunityAlerts:
        return await self.community.alerts_for(user.id)

    async def set_alerts(self, user: AppUser, subscribed: bool) -> CommunityAlerts:
        return await self.community.set_alerts(user.id, subscribed)
