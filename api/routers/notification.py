"""The in-app inbox, for any signed-in user (staff and residents). Each
caller only ever reaches their own notifications."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from dependencies import get_current_user, get_notification_service
from models.notification import (
    NotificationItem,
    NotificationPreferences,
    ReadAllRequest,
    ReadAllResult,
    UnreadCount,
    UpdateNotificationPreferences,
)
from models.user import AppUser
from services.notification import NotificationService

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationItem])
async def list_notifications(
    before: datetime | None = Query(default=None, description="Only items created before this (the next page)"),
    limit: int = Query(default=50, ge=1, le=100),
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> list[NotificationItem]:
    """The caller's notifications, newest first."""
    return await service.inbox(user, before, limit)


# Before /notifications/{notification_id}, so these aren't read as ids.
@router.get("/notifications/unread-count", response_model=UnreadCount)
async def unread_count(
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> UnreadCount:
    return await service.unread_count(user)


@router.post("/notifications/read-all", response_model=ReadAllResult)
async def read_all(
    body: ReadAllRequest,
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> ReadAllResult:
    """Marks the caller's unread notifications read: all of them, or only
    one case's (`case_id`, sent when a case or request screen opens)."""
    return await service.read_all(user, body.case_id)


@router.get("/notifications/{notification_id}", response_model=NotificationItem)
async def get_notification(
    notification_id: UUID,
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> NotificationItem:
    """One notification; opening it marks it read. 404 if it isn't the caller's."""
    return await service.get(user, notification_id)


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_notification(
    notification_id: UUID,
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> Response:
    await service.read(user, notification_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/notification-preferences", response_model=NotificationPreferences)
async def get_preferences(
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> NotificationPreferences:
    return await service.preferences(user)


@router.patch("/me/notification-preferences", response_model=NotificationPreferences)
async def update_preferences(
    body: UpdateNotificationPreferences,
    user: AppUser = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
) -> NotificationPreferences:
    """Only the fields sent change; `quiet_start: null` clears it."""
    return await service.update_preferences(user, body)
