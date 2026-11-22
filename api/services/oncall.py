"""On call (docs/design/on-call-and-push.md D1): shifts, with the "On call"
switch as an override. Admins keep the rota; any staff member sees it and
switches themselves on or off. The overlap and staff-only rules live in the
SQL (0015_oncall_shifts.sql); this module maps them to errors and owns the
rules about time: when a switched-on shift ends by default, and which
ranges a caller may ask for.

Urgent alerts (D3): a case that `pages_on_call` gets an alert, opened in the
same transaction as the case write (`open_for_case`), and offered step by
step down the ladder by the jobs in services/oncall_jobs.py. Staff accept
(the first one wins), pass, and say they've arrived here; the state rules
are in 0018_urgent_alerts.sql."""

import logging
from collections.abc import Callable
from datetime import datetime, time, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from databridge.executor import FunctionCaller, Transactions
from databridge.job import JobDatabridge
from databridge.oncall import OncallDatabridge
from errors import ApiError, not_found
from models.case import Case
from models.case_enums import pages_on_call
from models.notification import NotificationKind
from models.oncall import (
    AlertStatus,
    CreateShiftRequest,
    OncallAlert,
    OncallAlertDetail,
    OncallMe,
    OncallNow,
    OncallShift,
    OncallStats,
    PassRequest,
    ShiftRank,
    ShiftSource,
    ToggleOncallRequest,
    UpdateShiftRequest,
)
from models.staff import StaffMember
from services.notification import NotificationService
from services.oncall_jobs import enqueue_offer, follow_up
from services.task import TaskService

logger = logging.getLogger(__name__)

# Where the A3 shift blocks change over (day, evening, overnight), org time.
SHIFT_BOUNDARIES = (time(7), time(17), time(23))
MAX_UNTIL = timedelta(hours=24)
MAX_RANGE = timedelta(days=31)
MAX_STATS_RANGE = timedelta(days=366)


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
        *,
        jobs: JobDatabridge,
        notifications: NotificationService,
        tasks: TaskService,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        # Shifts and alerts: one databridge (0015 and 0018).
        self.shifts = shifts
        self.executor = executor
        self.tz = tz
        self.jobs = jobs
        self.notifications = notifications
        self.tasks = tasks
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

    # --- Urgent alerts -------------------------------------------------------------

    async def open_for_case(self, tx: FunctionCaller, case: Case) -> UUID | None:
        """Inside the case write's transaction: an alert for a case that pages
        on call, and the job that offers it. Nothing when the case doesn't
        page or already has an open alert. Returns the new alert's id."""
        if not pages_on_call(case):
            return None
        alert = await self.shifts.within(tx).open_alert(case.id)
        if alert is None:
            return None
        await enqueue_offer(self.jobs.within(tx), alert.id, alert.step)
        logger.info("Alert %s opened for case #%s", alert.id, case.number)
        return alert.id

    async def resolve_for_case(self, tx: FunctionCaller, case_id: UUID, status: AlertStatus) -> None:
        """Inside the case write's transaction: the case's open alert ends,
        `resolved` (someone assigned it by hand) or `cancelled` (the case was
        closed or stopped paging). Its jobs then find it closed."""
        for alert_id in await self.shifts.within(tx).resolve_for_case(case_id, status):
            logger.info("Alert %s %s", alert_id, status.value)

    async def sweep(self) -> int:
        """The worker's safety net: alerts for paging cases from the last 24
        hours that have none. Returns how many were opened."""
        async with self.executor.transaction() as tx:
            opened = await self.shifts.within(tx).sweep()
            for alert in opened:
                await enqueue_offer(self.jobs.within(tx), alert.id, alert.step)
        for alert in opened:
            logger.warning("Alert %s opened by the sweeper (a code path missed case %s)", alert.id, alert.case_id)
        return len(opened)

    async def alerts(self, worker: StaffMember, open_only: bool) -> list[OncallAlert]:
        return await self.shifts.alerts(worker.id, open_only)

    async def alert(self, worker: StaffMember, alert_id: UUID) -> OncallAlertDetail:
        found = await self.shifts.alert(alert_id, worker.id)
        if found is None:
            raise not_found("alert")
        return found

    async def accept(self, worker: StaffMember, alert_id: UUID) -> OncallAlertDetail:
        """Take the case. Any staff member may, while the alert is offering or
        unanswered; the first one wins and the case is theirs."""
        async with self.executor.transaction() as tx:
            alerts = self.shifts.within(tx)
            result = await alerts.accept(alert_id, worker.id)
            if result.outcome == "not_found":
                raise not_found("alert")
            if result.outcome == "already_accepted":
                # A repeat by the acceptor (the first response was lost on a
                # bad connection) succeeds: same answer, nothing changes.
                mine = await alerts.alert(alert_id, worker.id)
                if mine is not None and mine.accepted_by == worker.id:
                    return mine
                name = result.accepted_by_name or "Someone"
                raise ApiError(409, "already_accepted", f"{name} already accepted this")
            if result.outcome == "closed":
                raise ApiError(409, "alert_closed", "This alert is no longer open")
            if result.outcome != "accepted" or result.case_id is None:
                raise RuntimeError(f"app.oncall_accept returned {result.outcome!r}")
            # The case changed hands: its tasks follow, and the requester
            # hears it's in progress (as CaseService.update does).
            await self.tasks.remind_new_case_owner(tx, result.case_id)
            if result.status_update_id is not None:
                await self.notifications.notify(
                    tx, user_id=result.requester_id, kind=NotificationKind.REQUEST_UPDATE,
                    dedupe_key=f"update:{result.status_update_id}", actor_id=worker.id, case_id=result.case_id,
                    case_update_id=result.status_update_id,
                )
            detail = await alerts.alert(alert_id, worker.id)
        logger.info("Alert %s accepted by %s", alert_id, worker.id)
        if detail is None:
            raise not_found("alert")
        return detail

    async def pass_offer(self, worker: StaffMember, alert_id: UUID, body: PassRequest) -> OncallAlertDetail:
        """Pass on your offer. Once everyone in the step has passed, the alert
        moves to the next step now, in this transaction."""
        async with self.executor.transaction() as tx:
            alerts = self.shifts.within(tx)
            advance = await alerts.pass_offer(alert_id, worker.id, body.reason)
            if advance.outcome == "not_found":
                raise not_found("alert")
            if advance.outcome == "closed":
                raise ApiError(409, "alert_closed", "This alert is no longer open")
            if advance.outcome == "not_offered":
                raise ApiError(409, "not_offered", "You have no open offer on this alert")
            await follow_up(self.jobs.within(tx), alert_id, advance)
            detail = await alerts.alert(alert_id, worker.id)
        if detail is None:
            raise not_found("alert")
        return detail

    async def arrived(self, worker: StaffMember, alert_id: UUID) -> OncallAlertDetail:
        """Mark "I've arrived" (only whoever accepted)."""
        async with self.executor.transaction() as tx:
            alerts = self.shifts.within(tx)
            outcome = await alerts.arrived(alert_id, worker.id)
            if outcome == "not_found":
                raise not_found("alert")
            if outcome == "not_acceptor":
                raise ApiError(403, "not_acceptor", "Only the person who accepted can mark arrival")
            detail = await alerts.alert(alert_id, worker.id)
        if detail is None:
            raise not_found("alert")
        return detail

    async def stats(self, from_: datetime, to: datetime) -> OncallStats:
        if to <= from_:
            raise ApiError(422, "invalid_range", "`to` must be after `from`")
        if to - from_ > MAX_STATS_RANGE:
            raise ApiError(422, "range_too_long", "Ask for at most a year at a time")
        return await self.shifts.stats(from_, to)
