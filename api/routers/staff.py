"""ComForce staff: who is a worker, and (admins) who may become one."""

from uuid import UUID

from fastapi import APIRouter, Depends

from dependencies import get_current_admin, get_current_user, get_current_worker, get_staff_service
from models.staff import SetRoleRequest, StaffMember, StaffStatus, UserSummary, Worker
from models.user import AppUser
from services.staff import StaffService

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("/me", response_model=StaffStatus)
async def my_staff_status(
    user: AppUser = Depends(get_current_user),
    service: StaffService = Depends(get_staff_service),
) -> StaffStatus:
    """The caller's role, so the app knows whether to open the worker portal."""
    return await service.status(user)


@router.post("/bootstrap", response_model=StaffMember)
async def claim_first_admin(
    user: AppUser = Depends(get_current_user),
    service: StaffService = Depends(get_staff_service),
) -> StaffMember:
    """Makes the caller the first staff admin. Works only while nobody is
    staff yet (409 after that); from then on admins add workers."""
    return await service.bootstrap(user)


@router.get("/workers", response_model=list[Worker])
async def list_workers(
    _: StaffMember = Depends(get_current_worker),
    service: StaffService = Depends(get_staff_service),
) -> list[Worker]:
    """Everyone a case can be assigned to, with their open case counts."""
    return await service.list_workers()


@router.get("/users", response_model=list[UserSummary])
async def list_users(
    _: StaffMember = Depends(get_current_admin),
    service: StaffService = Depends(get_staff_service),
) -> list[UserSummary]:
    """Everyone who has signed in, staff first. Admins only."""
    return await service.list_users()


@router.put("/users/{user_id}/role", response_model=StaffMember)
async def set_role(
    user_id: UUID,
    body: SetRoleRequest,
    admin: StaffMember = Depends(get_current_admin),
    service: StaffService = Depends(get_staff_service),
) -> StaffMember:
    """Make someone a worker or admin, or back to a member. Admins only, and
    not for their own role."""
    return await service.set_role(admin, user_id, body.role)
