"""The staff domain: which signed-in users are ComForce MKE workers."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from models.base import ApiModel


class Role(StrEnum):
    MEMBER = "member"
    WORKER = "worker"
    ADMIN = "admin"


STAFF_ROLES = frozenset({Role.WORKER, Role.ADMIN})


class StaffMember(ApiModel):
    id: UUID
    display_name: str | None = None
    role: Role


class StaffStatus(ApiModel):
    """The caller's own standing, for the app to decide what to show."""

    id: UUID
    display_name: str | None = None
    role: Role
    is_worker: bool
    is_admin: bool


class Worker(ApiModel):
    id: UUID
    display_name: str | None = None
    role: Role
    open_cases: int


class UserSummary(ApiModel):
    id: UUID
    display_name: str | None = None
    role: Role
    created_at: datetime


class SetRoleRequest(ApiModel):
    role: Role
