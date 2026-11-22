"""Worker training (Figma T1, T2): which course modules each staff member
has finished. The course content is in the app (src/lib/training.ts); this
keeps progress so it survives a restart, and lets admins see who is ready
for the field. Staff only; the team view is for admins."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Path

from databridge.base import Databridge
from dependencies import get_current_admin, get_current_worker, get_executor
from errors import ApiError
from models.base import ApiModel
from models.staff import StaffMember

router = APIRouter(prefix="/training", tags=["training"])

# The course's module ids (apps/mobile/src/lib/training.ts), and which are required.
MODULES: dict[str, bool] = {
    "orientation": True,
    "field-safety": True,
    "de-escalation": True,
    "trauma-informed": True,
    "dv-response": True,
    "referrals": False,
    "privacy": True,
    "first-aid": False,
}
REQUIRED = frozenset(m for m, required in MODULES.items() if required)


class CompletedModule(ApiModel):
    module_id: str
    completed_at: datetime


class TrainingProgress(ApiModel):
    completed: list[CompletedModule]
    required_left: int
    ready: bool


class SetModuleRequest(ApiModel):
    done: bool


class TeamMemberTraining(ApiModel):
    user_id: UUID
    display_name: str | None = None
    role: str
    completed: list[str]
    required_left: int
    ready: bool


class TrainingDatabridge(Databridge):
    async def progress(self, user_id: UUID) -> list[CompletedModule]:
        rows = await self._rows("training_progress_list", user_id=user_id)
        return [CompletedModule(module_id=r["module_id"], completed_at=r["completed_at"]) for r in rows]

    async def set(self, user_id: UUID, module_id: str, done: bool) -> list[CompletedModule]:
        rows = await self._rows("training_progress_set", user_id=user_id, module_id=module_id, done=done)
        return [CompletedModule(module_id=r["module_id"], completed_at=r["completed_at"]) for r in rows]

    async def team(self) -> list[dict[str, object]]:
        return await self._rows("training_team")


def get_training() -> TrainingDatabridge:
    return TrainingDatabridge(get_executor())


def _progress(completed: list[CompletedModule]) -> TrainingProgress:
    known = [c for c in completed if c.module_id in MODULES]
    left = len(REQUIRED - {c.module_id for c in known})
    return TrainingProgress(completed=known, required_left=left, ready=left == 0)


@router.get("/progress", response_model=TrainingProgress)
async def my_progress(
    worker: StaffMember = Depends(get_current_worker),
    training: TrainingDatabridge = Depends(get_training),
) -> TrainingProgress:
    """The modules you've finished, and whether every required one is done."""
    return _progress(await training.progress(worker.id))


@router.put("/progress/{module_id}", response_model=TrainingProgress)
async def set_module(
    body: SetModuleRequest,
    module_id: str = Path(max_length=60),
    worker: StaffMember = Depends(get_current_worker),
    training: TrainingDatabridge = Depends(get_training),
) -> TrainingProgress:
    """Mark a module done (`done: true`) or not done."""
    if module_id not in MODULES:
        raise ApiError(404, "not_found", "No such training module")
    return _progress(await training.set(worker.id, module_id, body.done))


@router.get("/team", response_model=list[TeamMemberTraining])
async def team_progress(
    _: StaffMember = Depends(get_current_admin),
    training: TrainingDatabridge = Depends(get_training),
) -> list[TeamMemberTraining]:
    """Every staff member's progress, for admins."""
    out = []
    for row in await training.team():
        completed = [m for m in row["completed"] if m in MODULES]  # type: ignore[attr-defined]
        left = len(REQUIRED - set(completed))
        out.append(TeamMemberTraining(
            user_id=row["user_id"], display_name=row["display_name"], role=row["role"],
            completed=completed, required_left=left, ready=left == 0,
        ))
    return out
