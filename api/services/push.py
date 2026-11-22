"""Push devices, the test push, and the admin's delivery stats. The worker
does the sending (services/push_jobs.py); the API only records devices and
creates inbox rows, whose push jobs are queued with them."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from databridge.executor import Transactions
from databridge.push import PushDatabridge
from models.notification import NotificationKind
from models.push import NotificationStats, RegisterDeviceRequest
from models.user import AppUser
from services.notification import NotificationService

logger = logging.getLogger(__name__)

STATS_WINDOW = timedelta(hours=24)


class PushService:
    def __init__(
        self, push: PushDatabridge, notifications: NotificationService, transactions: Transactions
    ) -> None:
        self.push = push
        self.notifications = notifications
        self.transactions = transactions

    async def register(self, user: AppUser, device: RegisterDeviceRequest) -> None:
        """On every launch: the token is this user's now (a phone that
        changed hands moves over)."""
        saved = await self.push.register(
            user.id, token=device.token.lower(), platform=device.platform, environment=device.environment,
            app_version=device.app_version,
        )
        logger.info("Push device %s registered for user %s (%s)", saved.id, user.id, saved.environment.value)

    async def remove(self, user: AppUser, token: str) -> None:
        """Sign-out. Removing a device that isn't there (or isn't theirs)
        succeeds too: there's nothing to undo."""
        await self.push.remove(user.id, token.lower())

    async def send_test(self, user: AppUser) -> None:
        """A `test` notification for the caller; its push job sends it to
        each of their devices."""
        async with self.transactions.transaction() as tx:
            await self.notifications.notify(
                tx, user_id=user.id, kind=NotificationKind.TEST, dedupe_key=f"test:{uuid4()}", actor_id=None
            )

    async def stats(self, now: datetime | None = None) -> NotificationStats:
        since = (now or datetime.now(timezone.utc)) - STATS_WINDOW
        return await self.push.stats(since)
