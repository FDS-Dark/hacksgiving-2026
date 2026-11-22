"""On call: who is on now and next, the rota, and the "On call" switch.
ComForce staff only (403 otherwise); changing the rota is for admins."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import AwareDatetime

from dependencies import get_current_admin, get_current_worker, get_oncall_service
from models.oncall import CreateShiftRequest, OncallNow, OncallShift, ToggleOncallRequest, UpdateShiftRequest
from models.staff import StaffMember
from services.oncall import OncallService

router = APIRouter(prefix="/oncall", tags=["oncall"])


@router.get("/now", response_model=OncallNow)
async def oncall_now(
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> OncallNow:
    """Who is on call now (primary first), who is next within 12 hours, and
    whether the caller is on."""
    return await service.now(worker)


@router.post("/me", response_model=OncallNow)
async def toggle_oncall(
    body: ToggleOncallRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> OncallNow:
    """Switch yourself on call (until `until`, or the next 07:00, 17:00 or
    23:00 org time) or off (your shift ends now)."""
    return await service.toggle(worker, body)


@router.get("/shifts", response_model=list[OncallShift])
async def list_shifts(
    from_: Annotated[AwareDatetime, Query(alias="from")],
    to: Annotated[AwareDatetime, Query()],
    _: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> list[OncallShift]:
    """Shifts overlapping [from, to), by start then rank. At most 31 days."""
    return await service.search(from_, to)


@router.post("/shifts", response_model=OncallShift, status_code=status.HTTP_201_CREATED)
async def create_shift(
    body: CreateShiftRequest,
    admin: StaffMember = Depends(get_current_admin),
    service: OncallService = Depends(get_oncall_service),
) -> OncallShift:
    """Put someone on the rota (admins)."""
    return await service.create(admin, body)


@router.patch("/shifts/{shift_id}", response_model=OncallShift)
async def update_shift(
    shift_id: UUID,
    body: UpdateShiftRequest,
    admin: StaffMember = Depends(get_current_admin),
    service: OncallService = Depends(get_oncall_service),
) -> OncallShift:
    """Change a shift's person, times or rank (admins). Only fields sent change."""
    return await service.update(admin, shift_id, body)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: UUID,
    _: StaffMember = Depends(get_current_admin),
    service: OncallService = Depends(get_oncall_service),
) -> Response:
    """Remove a shift (admins)."""
    await service.delete(shift_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
