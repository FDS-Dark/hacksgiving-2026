from uuid import UUID

from databridge.base import Databridge
from models.user import AppUser


class UserDatabridge(Databridge):
    async def get_by_sub(self, sub: str) -> AppUser | None:
        row = await self._first("user_get_by_sub", sub=sub)
        return AppUser(**row) if row else None

    async def provision(self, sub: str, display_name: str | None) -> AppUser | None:
        """The new user, or None when they already existed."""
        row = await self._first("user_provision", sub=sub, display_name=display_name)
        return AppUser(**row) if row else None

    async def update(self, user_id: UUID, display_name: str | None, timezone: str | None) -> AppUser:
        return AppUser(**await self._one("user_update", user_id=user_id, display_name=display_name, timezone=timezone))
