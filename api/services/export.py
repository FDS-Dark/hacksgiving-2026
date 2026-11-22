"""Workers own their records: "Export my records" (staff Me) gives one CSV
of what the caller authored or owns. Their debriefs (the reviewed summary
and fields, never the text or the audio), the cases assigned to or opened
by them, the tasks they completed and the referral outcomes they confirmed.
Only the caller's own, by the verified token; never a resident's phone,
email or name."""

import csv
import io
from collections.abc import Iterable, Sequence
from typing import Any
from datetime import datetime, timezone

from databridge.export import ExportDatabridge
from models.export import ExportCase, ExportSummary, RecordsExport
from models.staff import StaffMember

# Spreadsheet apps run a cell that starts with one of these as a formula.
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    text = str(value)
    return "'" + text if text.startswith(FORMULA_START) else text


def summarize(debriefs: int, cases: Sequence[ExportCase], tasks: int, outcomes: int) -> ExportSummary:
    resolved = [c for c in cases if c.status in ("resolved", "closed")]
    return ExportSummary(
        debriefs=debriefs,
        cases=len(cases),
        cases_resolved=len(resolved),
        people_helped=sum(1 for c in cases if c.status in ("resolved", "closed") or c.helped > 0),
        tasks_completed=tasks,
        outcomes_confirmed=outcomes,
        referrals_helped=sum(c.helped for c in cases),
    )


def _section(writer: Any, title: str, header: Sequence[str], rows: Iterable[Sequence[object]]) -> None:
    writer.writerow([])
    writer.writerow([title])
    writer.writerow(header)
    for row in rows:
        writer.writerow([cell(v) for v in row])


class ExportService:
    def __init__(self, export: ExportDatabridge) -> None:
        self.export = export

    async def mine(self, worker: StaffMember, now: datetime | None = None) -> RecordsExport:
        now = now or datetime.now(timezone.utc)
        debriefs = await self.export.debriefs(worker.id)
        cases = await self.export.cases(worker.id)
        tasks = await self.export.tasks(worker.id)
        outcomes = await self.export.outcomes(worker.id)
        summary = summarize(len(debriefs), cases, len(tasks), len(outcomes))

        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\r\n")
        writer.writerow(["ComForce MKE: records export"])
        writer.writerows([
            ["Worker", cell(worker.display_name)],
            ["Generated", cell(now)],
            ["Debriefs", summary.debriefs],
            ["Cases", summary.cases],
            ["Cases resolved", summary.cases_resolved],
            ["People helped", summary.people_helped],
            ["Referrals that helped", summary.referrals_helped],
            ["Tasks completed", summary.tasks_completed],
            ["Referral outcomes confirmed", summary.outcomes_confirmed],
        ])
        _section(writer, "Debriefs",
                 ["Recorded", "Confirmed", "Status", "Source", "Title", "Summary", "Kind", "Service", "Priority",
                  "Location", "Risk flags", "Case"],
                 ([d.created_at, d.confirmed_at, d.status, d.source, d.title, d.summary, d.kind, d.category,
                   d.priority, d.location, d.risk_flags, d.case_number] for d in debriefs))
        _section(writer, "Cases",
                 ["Case", "Title", "Kind", "Service", "Priority", "Status", "Source", "Assigned to me",
                  "Opened by me", "Opened", "Resolved", "Referrals", "Referrals that helped"],
                 ([c.number, c.title, c.kind, c.category, c.priority, c.status, c.source, c.assigned, c.created,
                   c.created_at, c.resolved_at, c.referrals, c.helped] for c in cases))
        _section(writer, "Tasks completed",
                 ["Task", "Case", "Created", "Due", "Completed"],
                 ([t.title, t.case_number, t.created_at, t.due_at, t.completed_at] for t in tasks))
        _section(writer, "Referral outcomes confirmed",
                 ["Case", "Resource", "Status", "Delivered by", "Outcome", "Confirmed"],
                 ([o.case_number, o.resource_name, o.status,
                   ("ComForce MKE" + (f" ({o.delivered_by_worker_name})" if o.delivered_by_worker_name else ""))
                   if o.delivered_by == "comforce" else o.resource_name if o.delivered_by else None,
                   o.outcome, o.confirmed_at] for o in outcomes))
        return RecordsExport(
            filename=f"comforce-records-{now:%Y-%m-%d}.csv", generated_at=now, summary=summary, csv=out.getvalue(),
        )
