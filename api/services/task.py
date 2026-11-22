"""Tasks: the work a case needs. When a case comes in, `plan_tasks` turns it
into a first set of tasks by rules per category (AI can replace the rules
later; the rest of the pipeline won't change). Workers then close them."""

import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from databridge.executor import FunctionCaller, Transactions
from databridge.job import JobDatabridge
from databridge.task import TaskDatabridge
from errors import ApiError, not_found
from models.case import Case, ContactMethod
from models.case_enums import CaseCategory, CasePriority
from models.task import CreateTaskRequest, Task, TaskFilters, TaskStatus, UpdateTaskRequest
from models.staff import StaffMember
from services.notification_jobs import enqueue_task_reminder
from services.staff import StaffService

logger = logging.getLogger(__name__)

URGENT = frozenset({CasePriority.HIGH, CasePriority.CRITICAL})


@dataclass(frozen=True)
class PlannedTask:
    title: str
    detail: str
    # How long after the case came in the task is due.
    due_in: timedelta


# What each kind of request needs after first contact. Titles are written
# for the worker who'll do them.
FOLLOW_UPS: dict[CaseCategory, list[tuple[str, str]]] = {
    CaseCategory.HOMELESSNESS: [
        ("Find a shelter bed for tonight", "Check family shelters first when there are children."),
        ("Offer a ride to the shelter", "Book a ride if they can't get there on their own."),
    ],
    CaseCategory.MEAL_PROGRAMS: [
        ("Connect them with a pantry or meal program", "Pick one they can reach today."),
    ],
    CaseCategory.TRANSPORTATION: [
        ("Arrange the ride", "Confirm the pickup address, time and where they need to be."),
    ],
    CaseCategory.VIOLENCE_PREVENTION: [
        ("Check their safety", "Is anyone in danger right now? Call 911 if so."),
        ("Connect them with a violence-prevention partner", "Share only what they agree to share."),
    ],
    CaseCategory.INCIDENT_DEESCALATION: [
        ("Send a responder to the location", "Two people where possible. Call 911 if anyone is hurt or armed."),
    ],
    CaseCategory.MISSING_PERSONS: [
        ("Get a description and the last place they were seen", "A recent photo helps."),
        ("Share with partners and police", "Only with the family's agreement."),
    ],
    CaseCategory.BURIAL_ASSISTANCE: [
        ("Connect the family with burial assistance", "Note any deadline the funeral home gave them."),
    ],
    CaseCategory.BRIDGE_TO_EMPLOYMENT: [
        ("Schedule a jobs and training intake", "Ask about ID, resume and any record they want help with."),
    ],
    CaseCategory.OTHER: [
        ("Find out what they need and set the category", "Then refer them or open the right tasks."),
    ],
}

# Categories where someone may be in danger right now: work starts at once,
# whatever the priority says.
IMMEDIATE = frozenset({CaseCategory.INCIDENT_DEESCALATION, CaseCategory.MISSING_PERSONS})


def _contact_task(case: Case, due: timedelta) -> PlannedTask:
    if case.contact_method == ContactMethod.NONE:
        return PlannedTask(
            "Review the request (no contact wanted)",
            "They asked not to be contacted. Act on what they wrote; post updates on their request instead.",
            due,
        )
    verb = "Text" if case.contact_method == ContactMethod.TEXT else "Call"
    if case.safe_to_contact is False:
        caution = (
            "Not safe to leave a voicemail. If someone else answers, don't say who you are or why you're calling."
            if verb == "Call"
            else "Not safe to text freely: keep messages short and don't name ComForce or the request."
        )
    else:
        caution = "They said it's safe to reach them."
    return PlannedTask(f"{verb} the requester", caution, due)


def plan_tasks(case: Case) -> list[PlannedTask]:
    """The first tasks for a new case: reach the person (respecting how they
    asked to be reached), then the category's follow-ups."""
    urgent = case.priority in URGENT or case.category in IMMEDIATE
    first = timedelta(minutes=15) if urgent else timedelta(hours=1)
    later = timedelta(hours=2) if urgent else timedelta(hours=24)

    planned = [_contact_task(case, first)]
    for title, detail in FOLLOW_UPS[case.category]:
        planned.append(PlannedTask(title, detail, later))
    return planned


class TaskService:
    def __init__(
        self, tasks: TaskDatabridge, staff: StaffService, jobs: JobDatabridge, transactions: Transactions
    ) -> None:
        self.tasks = tasks
        self.staff = staff
        # Each task and its reminder job (services/notification_jobs.py) are
        # written in one transaction.
        self.jobs = jobs
        self.transactions = transactions

    async def generate_for(self, case: Case) -> list[Task]:
        """Creates the planned tasks for a case that just came in, each with
        its reminder. Never raises: a case without tasks is better than a
        lost request."""
        created: list[Task] = []
        try:
            for plan in plan_tasks(case):
                async with self.transactions.transaction() as tx:
                    task = await self.tasks.within(tx).create(
                        case.id, plan.title, plan.detail, case.created_at + plan.due_in, None, None
                    )
                    if task:
                        await enqueue_task_reminder(self.jobs.within(tx), task)
                if task:
                    created.append(task)
        except Exception:
            logger.exception("Generating tasks for case #%s failed", case.number)
        return created

    async def for_case(self, case_id: UUID) -> list[Task]:
        return await self.tasks.search(case_id=case_id, assigned_worker_id=None, open_only=False, limit=500)

    async def search(self, worker: StaffMember, filters: TaskFilters) -> list[Task]:
        return await self.tasks.search(
            case_id=filters.case_id,
            assigned_worker_id=worker.id if filters.mine else None,
            open_only=filters.open_only,
            limit=filters.limit,
        )

    async def add(self, worker: StaffMember, case_id: UUID, body: CreateTaskRequest) -> Task:
        """A task a worker adds by hand; noted in the case history."""
        await self._check_assignee(body.assigned_worker_id)
        async with self.transactions.transaction() as tx:
            task = await self.tasks.within(tx).add(case_id, body.title, body.due_at, body.assigned_worker_id, worker.id)
            if task is None:
                raise not_found("case")
            await enqueue_task_reminder(self.jobs.within(tx), task)
        return task

    async def update(self, worker: StaffMember, task_id: UUID, changes: UpdateTaskRequest) -> Task:
        if not changes.model_fields_set:
            raise ApiError(422, "no_changes", "Send at least one field to change")
        await self._check_assignee(changes.assigned_worker_id)
        async with self.transactions.transaction() as tx:
            task = await self.tasks.within(tx).update(
                task_id, worker.id, changes.status, changes.assigned_worker_id, changes.unassign
            )
            if task is None:
                raise not_found("task")
            if "assigned_worker_id" in changes.model_fields_set or changes.status == TaskStatus.OPEN:
                # A new owner, or a task reopened: queue its reminder again
                # (one per due time; the notification is once per person).
                await enqueue_task_reminder(self.jobs.within(tx), task)
        return task

    async def remind_new_case_owner(self, tx: FunctionCaller, case_id: UUID) -> None:
        """The case changed hands: tasks without their own assignee follow it,
        so queue the open tasks' reminders again (one that already ran found
        no owner, or told the previous holder). A task whose owner didn't
        change is harmless: its notification is deduplicated per person."""
        for task in await self.tasks.within(tx).search(
            case_id=case_id, assigned_worker_id=None, open_only=True, limit=500
        ):
            await enqueue_task_reminder(self.jobs.within(tx), task)

    async def _check_assignee(self, worker_id: UUID | None) -> None:
        if worker_id is not None and not await self.staff.is_worker(worker_id):
            raise ApiError(422, "not_a_worker", "Tasks can only be assigned to ComForce staff")
