from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from databridge.base import Databridge
from models.oncall import OncallShift, ShiftRank, ShiftSource

SHIFT_FIELDS = ("id", "user_id", "display_name", "starts_at", "ends_at", "rank", "source")


def _shift(row: dict) -> OncallShift:
    return OncallShift(**{key: row[key] for key in SHIFT_FIELDS})


@dataclass(frozen=True)
class OncallSnapshot:
    """What app.oncall_now returns: the shifts covering the moment, and the next one."""

    current: list[OncallShift]
    next: OncallShift | None


@dataclass(frozen=True)
class SaveResult:
    # "saved", "not_found", "not_a_worker", "invalid_range" or "overlap".
    outcome: str
    shift: OncallShift | None


class OncallDatabridge(Databridge):
    async def now(self, at: datetime | None = None) -> OncallSnapshot:
        rows = await self._rows("oncall_now", at=at)
        current = [_shift(row) for row in rows if row["slot"] == "current"]
        upcoming = [_shift(row) for row in rows if row["slot"] == "next"]
        return OncallSnapshot(current=current, next=upcoming[0] if upcoming else None)

    async def search(self, from_: datetime, to: datetime) -> list[OncallShift]:
        rows = await self._rows("oncall_shift_list", **{"from": from_, "to": to})
        return [_shift(row) for row in rows]

    async def save(
        self,
        shift_id: UUID | None,
        user_id: UUID | None,
        starts_at: datetime | None,
        ends_at: datetime | None,
        rank: ShiftRank | None,
        source: ShiftSource | None,
        actor_id: UUID,
    ) -> SaveResult:
        row = await self._one(
            "oncall_shift_save",
            id=shift_id, user_id=user_id, starts_at=starts_at, ends_at=ends_at,
            rank=rank, source=source, actor_id=actor_id,
        )
        return SaveResult(row["outcome"], _shift(row) if row["outcome"] == "saved" else None)

    async def delete(self, shift_id: UUID) -> bool:
        return await self._first("oncall_shift_delete", id=shift_id) is not None

    async def toggle(
        self, user_id: UUID, on: bool, until: datetime | None, default_until: datetime | None
    ) -> OncallShift | None:
        row = await self._first("oncall_toggle", user_id=user_id, on=on, until=until, default_until=default_until)
        return _shift(row) if row else None
