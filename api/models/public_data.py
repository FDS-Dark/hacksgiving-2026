"""Public data: what the API serves from the public-data tables
(0014_public_data.sql, routers/public_data.py). The data loader (dataloader/)
fills them; these response models are the generalized views, never the
stored rows."""

from datetime import date, datetime

from pydantic import Field

from models.base import ApiModel


class IncidentPoint(ApiModel):
    """A reviewed incident, generalized to about 1 km."""

    incident_at: datetime
    district: str | None = None
    latitude: float
    longitude: float
    offense_codes: list[str]
    category: str | None = Field(default=None, description="The app's map category, from the NIBRS codes.")
    weapons: list[str]


class TractCount(ApiModel):
    tract_geoid: str
    tract_name: str | None = None
    incidents: int


class DispatchCall(ApiModel):
    """A delayed dispatch call: not a confirmed incident."""

    source: str
    call_number: str
    occurred_at: datetime
    category: str
    status: str | None = None
    district: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class TransitArrival(ApiModel):
    route_id: str
    route_name: str | None = None
    arrives_at: datetime
    minutes: int


class TransitStop(ApiModel):
    stop_id: str
    code: str | None = None
    name: str
    latitude: float
    longitude: float
    distance_m: float
    routes: list[str]
    route_names: list[str]
    arrivals: list[TransitArrival] = Field(default_factory=list)


class TransitAlert(ApiModel):
    id: str
    header: str
    description: str
    effect: str | None = None
    url: str | None = None
    routes: list[str]
    active_until: datetime | None = None


class TransitNearby(ApiModel):
    stops: list[TransitStop]
    alerts: list[TransitAlert]
    arrivals_live: bool = Field(description="false when the live arrivals feed couldn't be read.")
    attribution: str = "Transit data from MCTS. Not sponsored or operated by MTS or MCTS."


class WeatherAlert(ApiModel):
    id: str
    event: str
    headline: str | None = None
    severity: str | None = None
    urgency: str | None = None
    area: str | None = None
    description: str
    instruction: str | None = None
    url: str | None = None
    effective_at: datetime | None = None
    expires_at: datetime | None = None


class CommunityMeasure(ApiModel):
    tract_geoid: str
    measure_id: str
    measure: str
    year: int
    value: float | None = None
    low: float | None = None
    high: float | None = None


class CrimeTrendPoint(ApiModel):
    offense: str
    measure: str
    series: str
    month: date
    value: float | None = None


class SourceHealth(ApiModel):
    source: str
    target: str
    status: str
    finished_at: datetime
    fetched: int
    detail: str
    last_success_at: datetime | None = None
