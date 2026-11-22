"""On call: who is on now and next, the rota, the "On call" switch, and
urgent alerts (accept, pass, arrived). ComForce staff only (403 otherwise);
changing the rota and the stats are for admins."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import AwareDatetime

from dependencies import get_current_admin, get_current_worker, get_handoff_service, get_oncall_service
from models.handoff import ShiftHandoff
from models.oncall import (
    CreateShiftRequest,
    OncallAlert,
    OncallAlertDetail,
    OncallNow,
    OncallShift,
    OncallStats,
    PassRequest,
    ToggleOncallRequest,
    UpdateShiftRequest,
)
from models.staff import StaffMember
from services.handoff import HandoffService
from services.oncall import OncallService

logger = logging.getLogger(__name__)

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
    handoffs: HandoffService = Depends(get_handoff_service),
) -> OncallNow:
    """Switch yourself on call (until `until`, or the next 07:00, 17:00 or
    23:00 org time) or off (your shift ends now). Going off writes a shift
    handoff brief for whoever is on next (`GET /oncall/handoffs`)."""
    was_on = (await service.now(worker)).me.on_call if not body.on else False
    after = await service.toggle(worker, body)
    if was_on and not after.me.on_call:
        try:
            await handoffs.going_off(worker, after)
        except Exception:
            # The brief is a courtesy: going off call never fails because of it.
            logger.exception("Couldn't write the shift handoff for %s", worker.id)
    return after


@router.get("/handoffs", response_model=list[ShiftHandoff])
async def my_handoffs(
    worker: StaffMember = Depends(get_current_worker),
    handoffs: HandoffService = Depends(get_handoff_service),
) -> list[ShiftHandoff]:
    """Shift handoff briefs you wrote or were handed in the last 7 days, newest first."""
    return await handoffs.mine(worker)


@router.get("/handoffs/{handoff_id}", response_model=ShiftHandoff)
async def get_handoff(
    handoff_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    handoffs: HandoffService = Depends(get_handoff_service),
) -> ShiftHandoff:
    return await handoffs.get(worker, handoff_id)


@router.post("/handoffs/{handoff_id}/summarize", response_model=ShiftHandoff)
async def summarize_handoff(
    handoff_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    handoffs: HandoffService = Depends(get_handoff_service),
) -> ShiftHandoff:
    """Rewrite the brief's summary with the AI (titles, priorities and due
    times only). 503 `ai_unavailable` when the assistant isn't set up."""
    return await handoffs.summarize(worker, handoff_id)


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


# --- Urgent alerts -------------------------------------------------------------------


@router.get("/alerts", response_model=list[OncallAlert])
async def list_alerts(
    open_only: bool = True,
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> list[OncallAlert]:
    """Urgent alerts, newest first: by default only open ones (offering or
    unanswered). `my_offer` is the caller's own offer, if any."""
    return await service.alerts(worker, open_only)


@router.get("/alerts/{alert_id}", response_model=OncallAlertDetail)
async def get_alert(
    alert_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> OncallAlertDetail:
    """One alert with what a responder needs (never contact details)."""
    return await service.alert(worker, alert_id)


@router.post("/alerts/{alert_id}/accept", response_model=OncallAlertDetail)
async def accept_alert(
    alert_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> OncallAlertDetail:
    """Take the case: it's assigned to the caller and in progress. Any staff
    member may while the alert is open; 409 `already_accepted` if someone
    was first."""
    return await service.accept(worker, alert_id)


@router.post("/alerts/{alert_id}/pass", response_model=OncallAlertDetail)
async def pass_alert(
    alert_id: UUID,
    body: PassRequest | None = None,
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> OncallAlertDetail:
    """Pass on your offer, optionally saying why. When everyone offered in
    the step has passed, it moves to the next person at once."""
    return await service.pass_offer(worker, alert_id, body or PassRequest())


@router.post("/alerts/{alert_id}/arrived", response_model=OncallAlertDetail)
async def alert_arrived(
    alert_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: OncallService = Depends(get_oncall_service),
) -> OncallAlertDetail:
    """Mark "I've arrived" (only whoever accepted); written to the case history."""
    return await service.arrived(worker, alert_id)


@router.get("/stats", response_model=OncallStats)
async def oncall_stats(
    from_: Annotated[AwareDatetime, Query(alias="from")],
    to: Annotated[AwareDatetime, Query()],
    _: StaffMember = Depends(get_current_admin),
    service: OncallService = Depends(get_oncall_service),
) -> OncallStats:
    """Alerts opened in [from, to): how many were accepted or went
    unanswered, average time to accept and to arrive, passes by reason
    (admins)."""
    return await service.stats(from_, to)
