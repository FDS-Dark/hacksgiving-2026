"""Milwaukee Police Department calls for service, as the app shows them:
generalized to the block, coordinates rounded to about 110 m."""

from datetime import datetime

from pydantic import Field

from models.base import ApiModel


class MpdCall(ApiModel):
    call_number: str = Field(description="MPD's call number, e.g. P2611210938.")
    dispatched_at: datetime
    block: str = Field(description="The block or intersection, never the exact address.")
    district: str = Field(description="Police district 1-7, or CITY / another agency code.")
    nature: str = Field(description="MPD's nature of call, e.g. 'Traffic Stop', 'Shooting'.")
    status: str
    category: str = Field(description="The app's grouping of `nature`: violent, weapons, property, traffic, "
                                      "disorder, assist or other.")
    latitude: float | None = None
    longitude: float | None = None


class CountItem(ApiModel):
    label: str
    count: int


class MpdCallSummary(ApiModel):
    hours: int = Field(description="The window the calls and counts cover.")
    total: int
    mapped: int = Field(description="Calls with coordinates (the rest couldn't be placed on the map).")
    by_category: list[CountItem]
    by_nature: list[CountItem] = Field(description="The most common call types, most first (top 10).")
    by_district: list[CountItem] = Field(description="Districts 1-7 in order, then any others.")
    by_hour: list[CountItem] = Field(description="Calls per clock hour (local time), oldest first, "
                                                 "labelled like '2 PM'.")


class MpdCalls(ApiModel):
    calls: list[MpdCall]
    summary: MpdCallSummary
    last_updated_at: datetime | None = Field(
        default=None, description="When ingestion last read the MPD page successfully.")
    stale: bool = Field(description="True when the last good read is more than 15 minutes old.")
    source: str = "https://itmdapps.milwaukee.gov/MPDCallData/"
