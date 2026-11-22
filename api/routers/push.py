"""Push notifications: the caller's devices, a test push, and delivery
stats for admins. Included before routers/notification.py, so
/notifications/test and /notifications/stats aren't read as ids."""

from fastapi import APIRouter, Depends, Path, Response, status

from dependencies import get_current_admin, get_current_user, get_push_service
from models.push import NotificationStats, RegisterDeviceRequest
from models.staff import StaffMember
from models.user import AppUser
from services.push import PushService
from services.rate_limit import push_test_requests

router = APIRouter(tags=["notifications"])


@router.put("/me/devices", status_code=status.HTTP_204_NO_CONTENT)
async def register_device(
    body: RegisterDeviceRequest,
    user: AppUser = Depends(get_current_user),
    service: PushService = Depends(get_push_service),
) -> Response:
    """The app sends its APNs token on every launch and when it rotates. A
    token another account had moves to this one."""
    await service.register(user, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me/devices/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_device(
    token: str = Path(pattern=r"^[0-9a-fA-F]{32,200}$"),
    user: AppUser = Depends(get_current_user),
    service: PushService = Depends(get_push_service),
) -> Response:
    """Sign-out, before the session is cleared. 204 even if it wasn't there."""
    await service.remove(user, token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/notifications/test", status_code=status.HTTP_202_ACCEPTED)
async def send_test(
    user: AppUser = Depends(get_current_user),
    service: PushService = Depends(get_push_service),
) -> Response:
    """A `test` notification for the caller, pushed to each of their
    devices. 3 per 10 minutes."""
    push_test_requests.check(str(user.id))
    await service.send_test(user)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.get("/notifications/stats", response_model=NotificationStats)
async def stats(
    _: StaffMember = Depends(get_current_admin),
    service: PushService = Depends(get_push_service),
) -> NotificationStats:
    """Push deliveries in the last 24 hours by status, devices, and the most
    common APNs failure reasons."""
    return await service.stats()
