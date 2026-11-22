"""Community alerts (Figma R5): a resident's opt-in to pushes about serious
weather in Milwaukee (services/weather_jobs.py sends them)."""

from models.base import ApiModel


class CommunityAlerts(ApiModel):
    subscribed: bool = False
