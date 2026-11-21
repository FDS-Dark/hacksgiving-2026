"""Tasks: the work each case needs. ComForce staff only (403 otherwise)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from dependencies import get_current_worker, get_task_service
from models.case import Task, TaskFilters, UpdateTaskRequest
from models.staff import StaffMember
from services.tasks import TaskService

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[Task])
async def list_tasks(
    filters: Annotated[TaskFilters, Query()],
    worker: StaffMember = Depends(get_current_worker),
    service: TaskService = Depends(get_task_service),
) -> list[Task]:
    """Open tasks by due time (soonest first). `mine` keeps the caller's:
    tasks assigned to them, and unassigned tasks on cases they hold."""
    return await service.search(worker, filters)


@router.patch("/{task_id}", response_model=Task)
async def update_task(
    task_id: UUID,
    body: UpdateTaskRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: TaskService = Depends(get_task_service),
) -> Task:
    """Mark a task done (or open again), or hand it to another worker
    (`assigned_worker_id: null` gives it back to whoever holds the case).
    Finishing a task is noted in the case history."""
    return await service.update(worker, task_id, body)
