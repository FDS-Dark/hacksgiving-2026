"""The staff Insights screen's filtered numbers and "Pattern spotted"
(0020_case_places.sql). Cases are counted by when they were opened."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field

from models.base import ApiModel
from models.case import CategoryCount
from models.case_enums import CaseCategory


class InsightsDistrict(ApiModel):
    """A police district, for the filter."""

    key: str
    name: str


class InsightsTotals(ApiModel):
    opened: int
    still_open: int
    resolved: int
    urgent: int = Field(description="Opened at high or critical priority.")
    placed: int = Field(description="With a known place; only these count toward a district or a pattern.")
    avg_resolution_hours: float | None = None


class PatternKind(StrEnum):
    # Several cases at one block or intersection (about 110 m).
    SPOT = "spot"
    # A neighborhood with at least twice as many cases as the period before.
    NEIGHBORHOOD = "neighborhood"


class Pattern(ApiModel):
    kind: PatternKind
    label: str = Field(description="A block, an intersection or a neighborhood; never a house number.")
    neighborhood: str | None = None
    police_district: str | None = None
    total: int
    prior_total: int = Field(description="Cases there in the period of the same length before.")
    top_category: CaseCategory | None = None
    top_category_total: int
    night_total: int = Field(description="Opened 6 PM to 6 AM, local time.")
    weekend_night_total: int = Field(description="Opened on a Friday or Saturday night.")
    first_at: datetime
    last_at: datetime
    case_ids: list[UUID] = Field(description="Newest first.")
    case_numbers: list[int]
    headline: str
    detail: str


class Insights(ApiModel):
    period_start: datetime
    period_end: datetime
    days: int
    district: str | None = None
    districts: list[InsightsDistrict]
    totals: InsightsTotals
    by_category: list[CategoryCount]
    patterns: list[Pattern]


class NeedMeasure(StrEnum):
    """CDC PLACES health-related social needs (percent of adults), loaded
    nightly by the cdc_places source."""

    HOUSING = "HOUSINSECU"
    FOOD = "FOODINSECU"
    TRANSPORTATION = "LACKTRPT"
    UTILITIES = "SHUTUTILITY"
    FOOD_STAMPS = "FOODSTAMP"
    EMOTIONAL_SUPPORT = "EMOTIONSPT"
    LONELINESS = "LONELINESS"


class TractCoverage(ApiModel):
    tract_geoid: str
    name: str
    latitude: float
    longitude: float
    need: float | None = Field(default=None, description="Percent of adults with the need (CDC model estimate).")
    cases: int = Field(description="ComForce cases of the matching service opened in the period, placed here.")
    incidents: int | None = Field(
        default=None, description="MPD-reviewed incidents in the period; null when under 5 (suppressed)."
    )
    gap: bool = Field(description="High need (top quarter) and few ComForce cases (bottom quarter).")


class Coverage(ApiModel):
    measure: NeedMeasure
    measure_label: str
    category: CaseCategory | None = Field(
        default=None, description="The ComForce service the need matches; null counts every case."
    )
    days: int
    need_year: int | None = None
    tracts: list[TractCoverage]
    gaps: list[TractCoverage] = Field(description="The biggest gaps first: highest need, fewest cases.")
    summary: str
