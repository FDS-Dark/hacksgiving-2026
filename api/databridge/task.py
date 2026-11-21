from datetime import datetime
from uuid import UUID

from databridge.base import Databridge
from models.task import Task, TaskStatus


class TaskDatabridge(Databridge):
    async def create(
        self,
        case_id: UUID,
        title: str,
        detail: str,
        due_at: datetime | None,
        assigned_worker_id: UUID | None,
        created_by: UUID | None,
    ) -> Task | None:
        row = await self._first(
            "task_create",
            case_id=case_id, title=title, detail=detail, due_at=due_at,
            assigned_worker_id=assigned_worker_id, created_by=created_by,
        )
        return Task(**row) if row else None

    async def search(
        self, *, case_id: UUID | None, assigned_worker_id: UUID | None, open_only: bool, limit: int
    ) -> list[Task]:
        rows = await self._rows(
            "task_list", case_id=case_id, assigned_worker_id=assigned_worker_id, open_only=open_only, limit=limit
        )
        return [Task(**row) for row in rows]

    async def get(self, task_id: UUID) -> Task | None:
        row = await self._first("task_get", task_id=task_id)
        return Task(**row) if row else None

    async def update(
        self, task_id: UUID, actor_id: UUID, status: TaskStatus | None, assigned_worker_id: UUID | None, unassign: bool
    ) -> Task | None:
        row = await self._first(
            "task_update",
            task_id=task_id, actor_id=actor_id, status=status,
            assigned_worker_id=assigned_worker_id, unassign=unassign,
        )
        return Task(**row) if row else None
