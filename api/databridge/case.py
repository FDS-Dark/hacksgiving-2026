from uuid import UUID

from databridge.base import Databridge
from models.case import (
    Case,
    CaseFilters,
    CaseKind,
    CaseSource,
    CaseStats,
    CaseUpdate,
    CategoryCount,
    PublicRequest,
    PublicRequestUpdate,
    StatusCount,
    UpdateCaseRequest,
    UpdateType,
    Visibility,
)


class CaseDatabridge(Databridge):
    async def create(
        self,
        *,
        kind: CaseKind,
        title: str,
        description: str,
        category: str,
        priority: str,
        source: CaseSource,
        location: str | None,
        latitude: float | None,
        longitude: float | None,
        contact_name: str | None,
        contact_phone: str | None,
        contact_email: str | None,
        requester_id: UUID | None,
        assigned_worker_id: UUID | None,
        created_by: UUID,
    ) -> Case:
        return Case(**await self._one(
            "case_create",
            kind=kind, title=title, description=description, category=category, priority=priority,
            source=source, location=location, latitude=latitude, longitude=longitude,
            contact_name=contact_name, contact_phone=contact_phone, contact_email=contact_email,
            requester_id=requester_id, assigned_worker_id=assigned_worker_id, created_by=created_by,
        ))

    async def search(self, f: CaseFilters) -> list[Case]:
        rows = await self._rows(
            "case_list",
            status=f.status, priority=f.priority, category=f.category, kind=f.kind,
            assigned_worker_id=f.assigned_worker_id, unassigned=f.unassigned, open_only=f.open_only,
            query=(f.q or "").strip() or None, limit=f.limit, offset=f.offset,
        )
        return [Case(**row) for row in rows]

    async def get(self, case_id: UUID) -> Case | None:
        row = await self._first("case_get", case_id=case_id)
        return Case(**row) if row else None

    async def update(self, case_id: UUID, actor_id: UUID, changes: UpdateCaseRequest) -> Case | None:
        row = await self._first(
            "case_update",
            case_id=case_id, actor_id=actor_id, kind=changes.kind, title=changes.title,
            description=changes.description, category=changes.category, priority=changes.priority,
            status=changes.status, location=changes.location,
            assigned_worker_id=changes.assigned_worker_id, unassign=changes.unassign,
        )
        return Case(**row) if row else None

    async def add_update(
        self, case_id: UUID, author_id: UUID | None, update_type: UpdateType, visibility: Visibility, content: str
    ) -> CaseUpdate | None:
        row = await self._first(
            "case_add_update",
            case_id=case_id, author_id=author_id, update_type=update_type, visibility=visibility, content=content,
        )
        return CaseUpdate(**row) if row else None

    async def list_updates(self, case_id: UUID) -> list[CaseUpdate]:
        return [CaseUpdate(**row) for row in await self._rows("case_list_updates", case_id=case_id)]

    async def recent_activity(self, limit: int) -> list[CaseUpdate]:
        return [CaseUpdate(**row) for row in await self._rows("case_recent_activity", limit=limit)]

    async def stats(self) -> CaseStats:
        return CaseStats(**await self._one("case_stats"))

    async def counts_by_category(self) -> list[CategoryCount]:
        return [CategoryCount(**row) for row in await self._rows("case_counts_by_category")]

    async def counts_by_status(self) -> list[StatusCount]:
        return [StatusCount(**row) for row in await self._rows("case_counts_by_status")]

    # --- The requester's view ----------------------------------------------------

    async def list_for_requester(self, user_id: UUID) -> list[PublicRequest]:
        return [PublicRequest(**row) for row in await self._rows("request_list_for_user", user_id=user_id)]

    async def get_for_requester(self, user_id: UUID, case_id: UUID) -> PublicRequest | None:
        row = await self._first("request_get_for_user", user_id=user_id, case_id=case_id)
        return PublicRequest(**row) if row else None

    async def list_public_updates(self, user_id: UUID, case_id: UUID) -> list[PublicRequestUpdate]:
        rows = await self._rows("request_list_updates_for_user", user_id=user_id, case_id=case_id)
        return [PublicRequestUpdate(**row) for row in rows]
