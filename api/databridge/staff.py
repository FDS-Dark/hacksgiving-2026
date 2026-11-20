from uuid import UUID

from databridge.base import Databridge
from models.staff import Role, StaffMember, UserSummary, Worker


class StaffDatabridge(Databridge):
    async def get(self, user_id: UUID) -> StaffMember | None:
        row = await self._first("staff_get", user_id=user_id)
        return StaffMember(**row) if row else None

    async def list_workers(self) -> list[Worker]:
        return [Worker(**row) for row in await self._rows("staff_list_workers")]

    async def list_users(self) -> list[UserSummary]:
        return [UserSummary(**row) for row in await self._rows("staff_list_users")]

    async def set_role(self, user_id: UUID, role: Role) -> StaffMember | None:
        row = await self._first("staff_set_role", user_id=user_id, role=role)
        return StaffMember(**row) if row else None

    async def bootstrap(self, user_id: UUID) -> StaffMember | None:
        """The caller as the first admin, or None when someone is staff already."""
        row = await self._first("staff_bootstrap", user_id=user_id)
        return StaffMember(**row) if row else None
