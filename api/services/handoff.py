"""Shift handoff briefs (feature 11): when a worker switches off call, a
snapshot of what they're leaving goes to whoever is on call next.

The brief is built here from the live data (open cases they own, their
open tasks, urgent alerts they accepted that are still open), with a plain
summary written by rules, so it works without the AI. "Summarize with AI"
rewrites the summary from the same snapshot when the assistant is set up.
The AI sees only titles, priorities, statuses and due times: never contact
details or case notes."""

import logging
from datetime import datetime, timezone
from uuid import UUID

from databridge.handoff import HandoffDatabridge
from databridge.oncall import OncallDatabridge
from errors import ApiError, not_found
from models.case import CaseFilters
from models.case_enums import CasePriority
from models.handoff import (
    HandoffAlert,
    HandoffBrief,
    HandoffCase,
    HandoffSummaryOutput,
    HandoffTask,
    ShiftHandoff,
    SummarySource,
)
from models.oncall import AlertStatus, OncallNow
from models.staff import StaffMember
from models.task import TaskFilters
from services.case import CaseService
from services.case_assist import BASE_INSTRUCTIONS, CaseAssistant
from services.task import TaskService

logger = logging.getLogger(__name__)

PRIORITY_ORDER = {CasePriority.CRITICAL: 0, CasePriority.HIGH: 1, CasePriority.MEDIUM: 2, CasePriority.LOW: 3}
OPEN_ALERTS = {AlertStatus.OFFERING, AlertStatus.UNANSWERED, AlertStatus.ACCEPTED}
LIST_DAYS = 7


def recipient_of(now: OncallNow, author_id: UUID) -> UUID | None:
    """Who the brief is for: whoever else is on call now (primary first),
    else the next person on."""
    for shift in now.on_call:
        if shift.user_id != author_id:
            return shift.user_id
    if now.next is not None and now.next.user_id != author_id:
        return now.next.user_id
    return None


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def rules_summary(brief: HandoffBrief) -> str:
    """A short read of the brief without the AI: the counts, then what to
    look at first."""
    if not (brief.cases or brief.tasks or brief.alerts):
        return "Nothing open to hand over: no cases, tasks or urgent responses in progress."
    urgent = [c for c in brief.cases if c.priority in (CasePriority.CRITICAL, CasePriority.HIGH)]
    overdue = [t for t in brief.tasks if t.overdue]
    parts = [
        f"{_plural(len(brief.cases), 'open case')}"
        + (f" ({len(urgent)} high or critical)" if urgent else ""),
        f"{_plural(len(brief.tasks), 'open task')}" + (f" ({len(overdue)} overdue)" if overdue else ""),
    ]
    if brief.alerts:
        parts.append(_plural(len(brief.alerts), "urgent response") + " in progress")
    lines = ["Handing over " + ", ".join(parts) + "."]
    first = [f"#{a.case_number} {a.case_title} (urgent response)" for a in brief.alerts[:2]]
    first += [f"#{c.number} {c.title} ({c.priority})" for c in urgent[:3]]
    first += [f"#{t.case_number}: {t.title} (overdue)" for t in overdue[:3]]
    if first:
        lines.append("Look at first: " + "; ".join(dict.fromkeys(first)) + ".")
    return " ".join(lines)


def ai_context(brief: HandoffBrief) -> str:
    """Only titles, priorities, statuses and due times reach the AI."""
    rows = ["Open cases:"] + [
        f"- #{c.number} {c.title} | priority {c.priority} | status {c.status} | {c.category}" for c in brief.cases
    ]
    rows += ["Open tasks:"] + [
        f"- {t.title} (case #{t.case_number}) | due {t.due_at.isoformat() if t.due_at else 'no date'}"
        + (" | OVERDUE" if t.overdue else "")
        for t in brief.tasks
    ]
    rows += ["Urgent responses in progress:"] + [
        f"- #{a.case_number} {a.case_title} | {a.status}" + (" | on scene" if a.arrived_at else "")
        for a in brief.alerts
    ]
    return "\n".join(rows)


class HandoffService:
    def __init__(
        self,
        handoffs: HandoffDatabridge,
        alerts: OncallDatabridge,
        cases: CaseService,
        tasks: TaskService,
        assistant: CaseAssistant | None = None,
    ) -> None:
        self.handoffs = handoffs
        self.alerts = alerts
        self.cases = cases
        self.tasks = tasks
        self.assistant = assistant

    async def build_brief(self, worker: StaffMember, now: datetime | None = None) -> HandoffBrief:
        now = now or datetime.now(timezone.utc)
        cases = await self.cases.search(CaseFilters(assigned_worker_id=worker.id, open_only=True, limit=100))
        cases.sort(key=lambda c: (PRIORITY_ORDER.get(c.priority, 9), -c.last_activity_at.timestamp()))
        tasks = await self.tasks.search(worker, TaskFilters(mine=True, open_only=True, limit=200))
        tasks.sort(key=lambda t: (t.due_at is None, t.due_at or now))
        alerts = [
            a for a in await self.alerts.alerts(worker.id, True)
            if a.accepted_by == worker.id and a.status in OPEN_ALERTS
        ]
        return HandoffBrief(
            cases=[
                HandoffCase(
                    id=c.id, number=c.number, title=c.title, priority=c.priority, status=c.status,
                    category=c.category, last_activity_at=c.last_activity_at,
                )
                for c in cases[:30]
            ],
            tasks=[
                HandoffTask(
                    id=t.id, title=t.title, due_at=t.due_at, overdue=bool(t.due_at and t.due_at < now),
                    case_id=t.case_id, case_number=t.case_number, case_title=t.case_title,
                )
                for t in tasks[:30]
            ],
            alerts=[
                HandoffAlert(
                    id=a.id, case_id=a.case_id, case_number=a.case_number, case_title=a.case_title,
                    status=a.status, arrived_at=a.arrived_at,
                )
                for a in alerts[:10]
            ],
        )

    async def going_off(self, worker: StaffMember, after: OncallNow) -> ShiftHandoff:
        """The brief for a worker who just switched off, for the next person."""
        brief = await self.build_brief(worker)
        handoff = await self.handoffs.create(worker.id, recipient_of(after, worker.id), brief, rules_summary(brief))
        logger.info("Shift handoff %s from %s to %s", handoff.id, worker.id, handoff.recipient_id)
        return handoff

    async def mine(self, worker: StaffMember, limit: int = 20) -> list[ShiftHandoff]:
        return await self.handoffs.list_for(worker.id, LIST_DAYS, limit)

    async def get(self, worker: StaffMember, handoff_id: UUID) -> ShiftHandoff:
        # Any staff member may read a brief: it's the team's working notes,
        # and admins cover for whoever is on.
        found = await self.handoffs.get(handoff_id)
        if found is None:
            raise not_found("handoff")
        return found

    async def summarize(self, worker: StaffMember, handoff_id: UUID) -> ShiftHandoff:
        handoff = await self.get(worker, handoff_id)
        if self.assistant is None:
            raise ApiError(503, "ai_unavailable", "AI assistance isn't set up; the summary above is still accurate")
        if not (handoff.brief.cases or handoff.brief.tasks or handoff.brief.alerts):
            return handoff
        out = await self.assistant._ask(
            BASE_INSTRUCTIONS + "\n\nWrite a shift handoff for the next person on call from the lists below.",
            ai_context(handoff.brief),
            HandoffSummaryOutput,
        )
        updated = await self.handoffs.set_summary(handoff_id, out.summary.strip()[:4000], SummarySource.AI)
        return updated or handoff
