"""On call: who is on now and next, the rota, and the "On call" switch
(services/oncall.py)."""

from enum import IntEnum, StrEnum
from uuid import UUID

from pydantic import AwareDatetime

from models.base import ApiModel


class ShiftSource(StrEnum):
    # An admin put it on the rota.
    SCHEDULE = "schedule"
    # The holder switched themselves on.
    TOGGLE = "toggle"


class ShiftRank(IntEnum):
    PRIMARY = 1
    BACKUP = 2


class OncallShift(ApiModel):
    id: UUID
    user_id: UUID
    display_name: str | None = None
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    rank: ShiftRank
    source: ShiftSource


class OncallMe(ApiModel):
    on_call: bool
    # The caller's shift covering now, when they're on.
    shift: OncallShift | None = None


class OncallNow(ApiModel):
    # Shifts covering now, primary first.
    on_call: list[OncallShift]
    # The first shift starting within 12 hours whose holder isn't on now.
    next: OncallShift | None = None
    me: OncallMe


class ToggleOncallRequest(ApiModel):
    """Switch yourself on or off. `until` (in the future, within 24 hours)
    sets when it ends; without it a new shift ends at the next 07:00, 17:00
    or 23:00 org time, and a running one keeps its end."""

    on: bool
    until: AwareDatetime | None = None


class CreateShiftRequest(ApiModel):
    user_id: UUID
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    rank: ShiftRank = ShiftRank.PRIMARY


class UpdateShiftRequest(ApiModel):
    """Only the fields sent change."""

    user_id: UUID | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    rank: ShiftRank | None = None
