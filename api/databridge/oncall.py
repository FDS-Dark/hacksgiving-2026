import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from databridge.base import Databridge
from databridge.executor import Row
from models.oncall import (
    AlertStatus,
    MyOffer,
    OncallAlert,
    OncallAlertDetail,
    OncallShift,
    OncallStats,
    PassReason,
    ShiftRank,
    ShiftSource,
)

SHIFT_FIELDS = ("id", "user_id", "display_name", "starts_at", "ends_at", "rank", "source")


def _shift(row: dict) -> OncallShift:
    return OncallShift(**{key: row[key] for key in SHIFT_FIELDS})


@dataclass(frozen=True)
class OncallSnapshot:
    """What app.oncall_now returns: the shifts covering the moment, and the next one."""

    current: list[OncallShift]
    next: OncallShift | None


@dataclass(frozen=True)
class StoredAlert:
    """A row of app.oncall_alerts, as the escalation steps need it."""

    id: UUID
    case_id: UUID
    status: AlertStatus
    step: int
    step_expires_at: datetime | None
    reminders_sent: int


def _stored_alert(row: Row) -> StoredAlert:
    return StoredAlert(
        id=row["id"], case_id=row["case_id"], status=AlertStatus(row["status"]), step=row["step"],
        step_expires_at=row["step_expires_at"], reminders_sent=row["reminders_sent"],
    )


@dataclass(frozen=True)
class Offer:
    id: UUID
    user_id: UUID
    expires_at: datetime


@dataclass(frozen=True)
class StepResult:
    """What app.oncall_offer_step did. outcome: 'offered' (`offers` holds the
    step's pending offers), 'unanswered' (nobody left on the ladder) or
    'noop' (the alert moved on or closed)."""

    outcome: str
    case_id: UUID | None
    step: int | None
    step_expires_at: datetime | None
    offers: list[Offer]


@dataclass(frozen=True)
class Advance:
    """What app.oncall_escalate and app.oncall_pass did. outcome: 'next'
    (now offering at `step`; its offers aren't made yet), 'unanswered' or
    'noop'; pass also 'passed' (others in the step still to answer),
    'not_offered', 'closed' and 'not_found'."""

    outcome: str
    step: int | None


@dataclass(frozen=True)
class AcceptResult:
    """outcome: 'accepted', 'already_accepted' (accepted_by_name says who),
    'closed' or 'not_found'. On 'accepted', status_update_id is the
    new -> in progress history entry, when the case was new."""

    outcome: str
    accepted_by_name: str | None
    case_id: UUID | None
    requester_id: UUID | None
    status_update_id: UUID | None


def next_name(names: list[str] | None) -> str | None:
    """Who the next step goes to: "Devon Park", or "Devon Park and 2 others"."""
    if not names:
        return None
    first, others = names[0], len(names) - 1
    return first if not others else f"{first} and {others} other{'s' if others > 1 else ''}"


ALERT_FIELDS = (
    "id", "case_id", "case_number", "case_title", "category", "priority", "status", "step", "step_expires_at",
    "created_at", "accepted_by", "accepted_by_name", "accepted_at", "arrived_at",
)
DETAIL_FIELDS = ("description", "location", "latitude", "longitude", "contact_method", "safe_to_contact")


def _alert_fields(row: Row) -> dict[str, Any]:
    my_offer = None
    if row["my_offer_id"] is not None:
        my_offer = MyOffer(
            id=row["my_offer_id"], step=row["my_offer_step"], expires_at=row["my_offer_expires_at"],
            outcome=row["my_offer_outcome"],
        )
    fields = {key: row[key] for key in ALERT_FIELDS}
    return fields | {"my_offer": my_offer, "next_name": next_name(row["next_names"])}


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

    # --- Urgent alerts (0018_urgent_alerts.sql) -----------------------------------

    async def ladder(self, step: int, alert_id: UUID | None) -> list[tuple[UUID, str | None]]:
        """Who step `step` offers to now, leaving out anyone already offered on the alert."""
        rows = await self._rows("oncall_ladder", step=step, alert_id=alert_id)
        return [(row["user_id"], row["display_name"]) for row in rows]

    async def open_alert(self, case_id: UUID) -> StoredAlert | None:
        """None when the case doesn't page or already has an open alert."""
        row = await self._first("oncall_alert_open", case_id=case_id)
        return _stored_alert(row) if row else None

    async def sweep(self) -> list[StoredAlert]:
        """Opens alerts for paging cases from the last 24 hours that have none."""
        return [_stored_alert(row) for row in await self._rows("oncall_alert_sweep")]

    async def stored_alert(self, alert_id: UUID) -> StoredAlert | None:
        row = await self._first("oncall_alert_get", alert_id=alert_id, user_id=None)
        return _stored_alert(row) if row else None

    async def offer_step(self, alert_id: UUID, step: int, offer_seconds: int) -> StepResult:
        rows = await self._rows("oncall_offer_step", alert_id=alert_id, step=step, offer_seconds=offer_seconds)
        first = rows[0]
        offers = [Offer(r["offer_id"], r["user_id"], r["expires_at"]) for r in rows if r["offer_id"] is not None]
        return StepResult(first["outcome"], first["case_id"], first["step"], first["step_expires_at"], offers)

    async def escalate(self, alert_id: UUID, step: int) -> Advance:
        row = await self._one("oncall_escalate", alert_id=alert_id, step=step)
        return Advance(row["outcome"], row["step"])

    async def remind(self, alert_id: UUID, n: int, max_reminders: int) -> tuple[str, UUID | None, list[UUID]]:
        """('reminded', the case, the admins to notify) or ('noop', None, [])."""
        rows = await self._rows("oncall_remind", alert_id=alert_id, n=n, max=max_reminders)
        outcome, case_id = rows[0]["outcome"], rows[0]["case_id"]
        return outcome, case_id, [r["user_id"] for r in rows if r["user_id"] is not None]

    async def accept(self, alert_id: UUID, user_id: UUID) -> AcceptResult:
        row = await self._one("oncall_accept", alert_id=alert_id, user_id=user_id)
        return AcceptResult(
            row["outcome"], row["accepted_by_name"], row["case_id"], row["requester_id"], row["status_update_id"]
        )

    async def pass_offer(self, alert_id: UUID, user_id: UUID, reason: PassReason | None) -> Advance:
        row = await self._one("oncall_pass", alert_id=alert_id, user_id=user_id, reason=reason)
        return Advance(row["outcome"], row["step"])

    async def arrived(self, alert_id: UUID, user_id: UUID) -> str:
        """'arrived', 'already' (set before), 'not_acceptor' or 'not_found'."""
        return str((await self._one("oncall_arrived", alert_id=alert_id, user_id=user_id))["outcome"])

    async def alert(self, alert_id: UUID, user_id: UUID) -> OncallAlertDetail | None:
        row = await self._first("oncall_alert_get", alert_id=alert_id, user_id=user_id)
        if row is None:
            return None
        return OncallAlertDetail(**_alert_fields(row), **{key: row[key] for key in DETAIL_FIELDS})

    async def alerts(self, user_id: UUID, open_only: bool) -> list[OncallAlert]:
        rows = await self._rows("oncall_alert_list", user_id=user_id, open_only=open_only)
        return [OncallAlert(**_alert_fields(row)) for row in rows]

    async def resolve_for_case(self, case_id: UUID, status: AlertStatus) -> list[UUID]:
        """Closes the case's open alerts; returns their ids."""
        return [row["id"] for row in await self._rows("oncall_resolve_for_case", case_id=case_id, status=status)]

    async def stats(self, from_: datetime, to: datetime) -> OncallStats:
        row = await self._one("oncall_stats", **{"from": from_, "to": to})
        passes = {reason.value: 0 for reason in PassReason} | {"none": 0}
        found = row["passes_by_reason"] or {}
        counts = json.loads(found) if isinstance(found, str) else found
        passes.update({key: int(value) for key, value in counts.items()})
        return OncallStats(
            alerts=row["alerts"], accepted=row["accepted"], unanswered=row["unanswered"],
            avg_seconds_to_accept=row["avg_seconds_to_accept"], avg_seconds_to_arrive=row["avg_seconds_to_arrive"],
            passes_by_reason=passes,
        )
