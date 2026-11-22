"""Where a case is (app.case_places, 0020): worked out by the worker from
the case's coordinates or its free-text location. Staff-only, and only
ever as rounded points, areas and block-level labels."""

from enum import StrEnum
from uuid import UUID

from models.base import ApiModel


class PlaceStatus(StrEnum):
    PLACED = "placed"
    UNPLACED = "unplaced"


class PlaceSource(StrEnum):
    CASE = "case"
    NEIGHBORHOOD = "neighborhood"
    GEOCODER = "geocoder"


class PendingPlace(ApiModel):
    """A case to place, with the values the place is worked out from."""

    case_id: UUID
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class CasePlace(ApiModel):
    case_id: UUID
    status: PlaceStatus
    source: PlaceSource | None = None
    latitude: float | None = None
    longitude: float | None = None
    label: str | None = None
    police_district: str | None = None
    tract_geoid: str | None = None
    neighborhood: str | None = None
