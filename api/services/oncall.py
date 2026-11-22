"""On call (docs/design/on-call-and-push.md D1): shifts, with the "On call"
switch as an override. Admins keep the rota; any staff member sees it and
switches themselves on or off. The overlap and staff-only rules live in the
SQL (0015_oncall_shifts.sql); this module maps them to errors and owns the
rules about time: when a switched-on shift ends by default, and which
ranges a caller may ask for."""

from collections.abc import Callable
from datetime import datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from databridge.executor import Transactions
from databridge.oncall import OncallDatabridge
from errors import ApiError, not_found
from models.oncall import (
    CreateShiftRequest,
    OncallMe,
    OncallNow,
    OncallShift,
    ShiftRank,
    ShiftSource,
    ToggleOncallRequest,
    UpdateShiftRequest,
)
from models.staff import StaffMember

# Where the A3 shift blocks change over (day, evening, overnight), org time.
SHIFT_BOUNDARIES = (time(7), time(17), time(23))
MAX_UNTIL = timedelta(hours=24)
MAX_RANGE = timedelta(days=31)


def default_until(now: datetime, tz: ZoneInfo) -> datetime:
    """The first of 07:00, 17:00 or 23:00 in `tz` strictly after `now`.

    Each boundary is a wall-clock time on a local date, so a DST change
    moves the instant, never the hour on the clock."""
    local = now.astimezone(tz)
    candidates = (
        datetime.combine(day, boundary, tzinfo=tz)
        for day in (local.date(), local.date() + timedelta(days=1))
        for boundary in SHIFT_BOUNDARIES
    )
    return next(c for c in candidates if c > now)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _check_range(starts_at: datetime | None, ends_at: datetime | None) -> None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ApiError(422, "invalid_range", "A shift must end after it starts")


class OncallService:
    def __init__(
        self,
        shifts: OncallDatabridge,
        executor: Transactions,
        tz: ZoneInfo,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self.shifts = shifts
        self.executor = executor
        self.tz = tz
        self.clock = clock

    async def now(self, worker: StaffMember) -> OncallNow:
        return await self._now(self.shifts, worker)

    async def toggle(self, worker: StaffMember, body: ToggleOncallRequest) -> OncallNow:
        """Switch the caller on or off, then who is on (in one transaction,
        so the answer reflects the switch)."""
        until = body.until if body.on else None
        default = None
        if body.on:
            now = self.clock()
            if until is not None and not now < until <= now + MAX_UNTIL:
                raise ApiError(422, "invalid_until", "Pick an end time in the next 24 hours")
            # Always sent when switching on: the SQL never needs the org's
            # shift blocks or time zone.
            default = default_until(now, self.tz)
        async with self.executor.transaction() as tx:
            shifts = self.shifts.within(tx)
            await shifts.toggle(worker.id, body.on, until, default)
            return await self._now(shifts, worker)

    async def search(self, from_: datetime, to: datetime) -> list[OncallShift]:
        if to <= from_:
            raise ApiError(422, "invalid_range", "`to` must be after `from`")
        if to - from_ > MAX_RANGE:
            raise ApiError(422, "range_too_long", "Ask for at most 31 days at a time")
        return await self.shifts.search(from_, to)

    async def create(self, admin: StaffMember, body: CreateShiftRequest) -> OncallShift:
        _check_range(body.starts_at, body.ends_at)
        return await self._save(
            admin, None, body.user_id, body.starts_at, body.ends_at, body.rank, ShiftSource.SCHEDULE
        )

    async def update(self, admin: StaffMember, shift_id: UUID, changes: UpdateShiftRequest) -> OncallShift:
        """Only the fields sent change. The SQL checks the merged shift (an
        end before the stored start is still `invalid_range`)."""
        if not changes.model_fields_set:
            raise ApiError(422, "no_changes", "Send at least one field to change")
        _check_range(changes.starts_at, changes.ends_at)
        return await self._save(
            admin, shift_id, changes.user_id, changes.starts_at, changes.ends_at, changes.rank, None
        )

    async def delete(self, shift_id: UUID) -> None:
        if not await self.shifts.delete(shift_id):
            raise not_found("shift")

    async def _save(
        self,
        admin: StaffMember,
        shift_id: UUID | None,
        user_id: UUID | None,
        starts_at: datetime | None,
        ends_at: datetime | None,
        rank: ShiftRank | None,
        source: ShiftSource | None,
    ) -> OncallShift:
        result = await self.shifts.save(shift_id, user_id, starts_at, ends_at, rank, source, admin.id)
        if result.outcome == "saved" and result.shift is not None:
            return result.shift
        if result.outcome == "not_found":
            raise not_found("shift")
        if result.outcome == "not_a_worker":
            raise ApiError(422, "not_a_worker", "Only ComForce staff can be on call")
        if result.outcome == "overlap":
            raise ApiError(409, "shift_overlap", "That person already has a shift at that time")
        if result.outcome == "invalid_range":
            raise ApiError(422, "invalid_range", "A shift must end after it starts")
        raise RuntimeError(f"app.oncall_shift_save returned {result.outcome!r}")

    @staticmethod
    async def _now(shifts: OncallDatabridge, worker: StaffMember) -> OncallNow:
        snapshot = await shifts.now()
        current = sorted(snapshot.current, key=lambda s: (s.rank, s.starts_at))
        mine = next((s for s in current if s.user_id == worker.id), None)
        return OncallNow(on_call=current, next=snapshot.next, me=OncallMe(on_call=mine is not None, shift=mine))
