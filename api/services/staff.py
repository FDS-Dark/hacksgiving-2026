"""Who may do what: members submit requests, workers handle cases, admins
also decide who is staff."""

import logging
from uuid import UUID

from databridge.staff import StaffDatabridge
from errors import ApiError, not_found
from models.staff import STAFF_ROLES, Role, StaffMember, StaffStatus, UserSummary, Worker
from models.user import AppUser

logger = logging.getLogger(__name__)


def forbidden(message: str) -> ApiError:
    return ApiError(403, "forbidden", message)


class StaffService:
    def __init__(self, staff: StaffDatabridge) -> None:
        self.staff = staff

    async def member(self, user: AppUser) -> StaffMember:
        member = await self.staff.get(user.id)
        if member is None:
            raise RuntimeError(f"User {user.id} has no app.users row")
        return member

    async def status(self, user: AppUser) -> StaffStatus:
        member = await self.member(user)
        return StaffStatus(
            id=member.id,
            display_name=member.display_name,
            role=member.role,
            is_worker=member.role in STAFF_ROLES,
            is_admin=member.role == Role.ADMIN,
        )

    async def require_worker(self, user: AppUser) -> StaffMember:
        member = await self.member(user)
        if member.role not in STAFF_ROLES:
            raise forbidden("ComForce staff only")
        return member

    async def require_admin(self, user: AppUser) -> StaffMember:
        member = await self.member(user)
        if member.role != Role.ADMIN:
            raise forbidden("Staff admins only")
        return member

    async def bootstrap(self, user: AppUser) -> StaffMember:
        """Makes the caller the first admin, while nobody is staff yet."""
        member = await self.staff.bootstrap(user.id)
        if member is None:
            raise ApiError(409, "staff_exists", "ComForce staff are already set up. Ask an admin to add you.")
        logger.info("User %s claimed the first staff admin", user.id)
        return member

    async def list_workers(self) -> list[Worker]:
        return await self.staff.list_workers()

    async def is_worker(self, user_id: UUID) -> bool:
        member = await self.staff.get(user_id)
        return member is not None and member.role in STAFF_ROLES

    async def list_users(self) -> list[UserSummary]:
        return await self.staff.list_users()

    async def set_role(self, admin: StaffMember, user_id: UUID, role: Role) -> StaffMember:
        if user_id == admin.id and role != Role.ADMIN:
            # So there is always at least the admin making the change.
            raise ApiError(422, "cannot_demote_self", "Ask another admin to change your own role")
        member = await self.staff.set_role(user_id, role)
        if member is None:
            raise not_found("user")
        logger.info("User %s set user %s to %s", admin.id, user_id, role)
        return member
