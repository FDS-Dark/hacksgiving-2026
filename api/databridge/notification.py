from datetime import datetime, time
from uuid import UUID

from databridge.base import Databridge
from models.notification import NotificationFacts, NotificationKind, NotificationPreferences, StoredNotification


class NotificationDatabridge(Databridge):
    async def create(
        self,
        *,
        user_id: UUID,
        kind: NotificationKind,
        dedupe_key: str,
        case_id: UUID | None = None,
        case_update_id: UUID | None = None,
        task_id: UUID | None = None,
        referral_id: UUID | None = None,
        actor_id: UUID | None = None,
        alert_id: UUID | None = None,
        expires_at: datetime | None = None,
    ) -> StoredNotification | None:
        """None when the row already exists (same user and dedupe key)."""
        row = await self._first(
            "notification_create",
            user_id=user_id, kind=kind, dedupe_key=dedupe_key, case_id=case_id, case_update_id=case_update_id,
            task_id=task_id, referral_id=referral_id, actor_id=actor_id, alert_id=alert_id,
            expires_at=expires_at,
        )
        return StoredNotification(**row) if row else None

    async def create_chat(
        self, *, user_id: UUID, kind: NotificationKind, dedupe_key: str, channel: str, case_id: UUID | None,
        actor_id: UUID,
    ) -> StoredNotification | None:
        """An inbox row about a chat channel (app.chat_notify). None when it
        already exists or `user_id` is the actor."""
        row = await self._first(
            "chat_notify", user_id=user_id, kind=kind, dedupe_key=dedupe_key, channel=channel, case_id=case_id,
            actor_id=actor_id,
        )
        return StoredNotification(**row) if row else None

    async def list_for(self, user_id: UUID, before: datetime | None, limit: int) -> list[NotificationFacts]:
        rows = await self._rows("notification_list", user_id=user_id, before=before, limit=limit)
        return [NotificationFacts(**row) for row in rows]

    async def get(self, user_id: UUID, notification_id: UUID) -> NotificationFacts | None:
        """Marks it read, too."""
        row = await self._first("notification_get", user_id=user_id, notification_id=notification_id)
        return NotificationFacts(**row) if row else None

    async def unread_count(self, user_id: UUID) -> int:
        return int((await self._one("notification_unread_count", user_id=user_id))["count"])

    async def read(self, user_id: UUID, notification_id: UUID) -> bool:
        return await self._first("notification_read", user_id=user_id, notification_id=notification_id) is not None

    async def read_all(self, user_id: UUID, case_id: UUID | None) -> int:
        return int((await self._one("notification_read_all", user_id=user_id, case_id=case_id))["updated"])

    async def preferences(self, user_id: UUID) -> NotificationPreferences:
        return NotificationPreferences(**await self._one("notification_preferences_get", user_id=user_id))

    async def save_preferences(
        self,
        user_id: UUID,
        *,
        push_enabled: bool,
        muted_kinds: list[NotificationKind],
        quiet_start: time | None,
        quiet_end: time | None,
        urgent_when_off_call: bool,
    ) -> NotificationPreferences:
        row = await self._one(
            "notification_preferences_save",
            user_id=user_id, push_enabled=push_enabled, muted_kinds=[k.value for k in muted_kinds],
            quiet_start=quiet_start, quiet_end=quiet_end, urgent_when_off_call=urgent_when_off_call,
        )
        return NotificationPreferences(**row)

    async def prune(self, days: int) -> int:
        return int((await self._one("notification_prune", days=days))["deleted"])
