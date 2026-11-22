"""What the loader imports into the public-data tables (0014_public_data.sql).
Each row is written in bulk as JSON (`ImportedRow.row()`) by the table's
`<table>_sync` function; the API serves generalized views of them, never
the stored rows."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class ImportedRow(BaseModel):
    """One row for a public-data table. `external_id` is the source's id."""

    external_id: str = Field(min_length=1, max_length=300)

    def row(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class ImportedArea(ImportedRow):
    kind: str
    name: str
    properties: dict[str, Any] = Field(default_factory=dict)
    geometry: dict[str, Any]
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float


class ImportedIncident(ImportedRow):
    incident_at: datetime
    last_edited_at: datetime | None = None
    district: str | None = None
    tract_geoid: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    offense_codes: list[str] = Field(default_factory=list)
    weapons: list[str] = Field(default_factory=list)


class ImportedSignal(ImportedRow):
    occurred_at: datetime
    category: str
    status: str | None = None
    district: str | None = None
    city: str | None = None
    tract_geoid: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    public: bool
    expires_at: datetime


class ImportedTransitRoute(ImportedRow):
    short_name: str | None = None
    long_name: str | None = None
    color: str | None = None
    text_color: str | None = None
    url: str | None = None


class ImportedTransitStop(ImportedRow):
    code: str | None = None
    name: str
    latitude: float
    longitude: float
    routes: list[str] = Field(default_factory=list)


class ImportedTransitAlert(ImportedRow):
    header: str
    description: str = ""
    cause: str | None = None
    effect: str | None = None
    url: str | None = None
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    active_from: datetime | None = None
    active_until: datetime | None = None


class ImportedWeatherAlert(ImportedRow):
    event: str
    headline: str | None = None
    severity: str | None = None
    urgency: str | None = None
    certainty: str | None = None
    area: str | None = None
    description: str = ""
    instruction: str | None = None
    url: str | None = None
    effective_at: datetime | None = None
    expires_at: datetime | None = None


class ImportedCommunityMeasure(ImportedRow):
    tract_geoid: str
    measure_id: str
    measure: str
    year: int
    value: float | None = None
    low: float | None = None
    high: float | None = None
    population: int | None = None


class ImportedCrimeTrend(ImportedRow):
    offense: str
    measure: str
    series: str
    month: date
    value: float | None = None
    source_refreshed_at: datetime | None = None
