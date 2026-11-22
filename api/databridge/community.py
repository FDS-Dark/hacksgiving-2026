from datetime import datetime
from uuid import UUID

from databridge.base import Databridge
from models.community import CommunityAlerts
from models.public_data import WeatherAlert


class CommunityDatabridge(Databridge):
    """Community alert opt-ins, and the weather alerts the worker acts on."""

    async def alerts_for(self, user_id: UUID) -> CommunityAlerts:
        return CommunityAlerts(**await self._one("community_alerts_get", user_id=user_id))

    async def set_alerts(self, user_id: UUID, subscribed: bool) -> CommunityAlerts:
        return CommunityAlerts(**await self._one("community_alerts_set", user_id=user_id, subscribed=subscribed))

    async def recipients(self) -> list[UUID]:
        return [row["user_id"] for row in await self._rows("community_alert_recipients")]

    async def claim_new_weather(self) -> list[tuple[str, WeatherAlert]]:
        """Alerts in effect that nobody acted on yet, as (source, alert);
        claimed by this call, so use it inside the acting transaction."""
        rows = await self._rows("weather_alert_claim_new")
        return [(r["source"], WeatherAlert(id=r["external_id"], **r)) for r in rows]

    async def outreach_tasks(self, title: str, detail: str, due_at: datetime) -> list[UUID]:
        rows = await self._rows("weather_outreach_tasks", title=title, detail=detail, due_at=due_at)
        return [row["id"] for row in rows]
