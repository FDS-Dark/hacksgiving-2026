"""Background jobs for the inbox. `task.remind` tells a task's owner 30
minutes before it is due. It follows the stage contract in
services/pipeline.py: `run` only reads, `finish` writes in the job's
completion transaction, and a late or duplicate job does nothing.

    task created, or its due time or assignee changed
        -> job task.remind at due_at - 30 min (now if that has passed, unless
           the task is more than 30 min overdue: then no job)
    worker: the task is still open, still due then, and has an owner
        -> a task_due notification for the owner (the task's assignee,
           else the case's)
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from databridge.executor import FunctionCaller
from databridge.job import JobDatabridge
from databridge.task import TaskDatabridge
from models.job import Job
from models.notification import NotificationKind
from models.task import Task, TaskStatus
from services.notification import NotificationService
from services.pipeline import Finish

TASK_REMIND = "task.remind"
REMIND_BEFORE = timedelta(minutes=30)


def _iso(at: datetime) -> str:
    """One spelling per instant (UTC), so keys from different requests match."""
    return at.astimezone(timezone.utc).isoformat()


async def enqueue_task_reminder(jobs: JobDatabridge, task: Task, *, now: datetime | None = None) -> bool:
    """Queue the reminder for `task`'s current due time. Twice for the same
    task and due time is one job. False when there is nothing to remind of
    (no due time, or long overdue)."""
    if task.due_at is None or task.status != TaskStatus.OPEN:
        return False
    now = now or datetime.now(timezone.utc)
    if task.due_at < now - REMIND_BEFORE:
        return False
    due, remind_at = _iso(task.due_at), task.due_at - REMIND_BEFORE
    await jobs.enqueue(
        TASK_REMIND,
        {"task_id": str(task.id), "due_at": due},
        # Already past: the database's now(), so the job is due at once
        # whatever this host's clock says.
        run_at=remind_at if remind_at > now else None,
        dedupe_key=f"task:{task.id}:remind:{due}",
    )
    return True


async def _nothing(_: FunctionCaller) -> None:
    return None


class TaskRemindStage:
    kind = TASK_REMIND
    timeout = 15.0

    def __init__(self, tasks: TaskDatabridge, notifications: NotificationService) -> None:
        self.tasks = tasks
        self.notifications = notifications

    async def run(self, job: Job) -> Finish:
        task = await self.tasks.get(UUID(str(job.payload["task_id"])))
        due = datetime.fromisoformat(str(job.payload["due_at"]))
        if (
            task is None
            or task.status == TaskStatus.DONE
            or task.due_at is None
            or task.due_at != due  # moved since: the job for the new time reminds
            or task.assigned_worker_id is None
        ):
            return _nothing
        owner, case_id, task_id = task.assigned_worker_id, task.case_id, task.id

        async def finish(tx: FunctionCaller) -> None:
            await self.notifications.notify(
                tx,
                user_id=owner,
                kind=NotificationKind.TASK_DUE,
                dedupe_key=f"task_due:{task_id}:{_iso(due)}",
                actor_id=None,
                case_id=case_id,
                task_id=task_id,
            )

        return finish

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        return None
