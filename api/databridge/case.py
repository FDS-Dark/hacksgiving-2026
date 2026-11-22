from uuid import UUID

from databridge.base import Databridge
from databridge.executor import Row
from models.case import (
    Case,
    CaseFilters,
    CaseKind,
    CaseSource,
    CaseStats,
    CaseUpdate,
    CategoryCount,
    ContactMethod,
    PublicRequest,
    PublicRequestUpdate,
    Referral,
    ReferralStatus,
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

    async def create_request(
        self,
        *,
        title: str,
        description: str,
        category: str,
        priority: str,
        location: str | None,
        latitude: float | None,
        longitude: float | None,
        contact_name: str | None,
        contact_phone: str | None,
        contact_email: str | None,
        contact_method: ContactMethod | None,
        safe_to_contact: bool | None,
        requester_id: UUID | None,
        access_code_hash: bytes | None,
    ) -> Case:
        """A resident's request: signed in (requester_id) or not (access_code_hash)."""
        return Case(**await self._one(
            "request_create",
            title=title, description=description, category=category, priority=priority,
            location=location, latitude=latitude, longitude=longitude,
            contact_name=contact_name, contact_phone=contact_phone, contact_email=contact_email,
            contact_method=contact_method, safe_to_contact=safe_to_contact,
            requester_id=requester_id, access_code_hash=access_code_hash,
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

    async def language(self, case_id: UUID) -> Row | None:
        return await self._first("case_language_get", case_id=case_id)

    async def set_language(self, case_id: UUID, language: str | None, source: str, actor_id: UUID | None) -> Row | None:
        return await self._first(
            "case_language_set", case_id=case_id, language=language, source=source, actor_id=actor_id
        )

    async def person_cases(self, case_id: UUID, limit: int) -> list[Case]:
        """The case and every case that looks like the same person (0021)."""
        return [Case(**row) for row in await self._rows("person_cases", case_id=case_id, limit=limit)]

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

    async def updates_this_transaction(self, case_id: UUID, author_id: UUID | None) -> list[CaseUpdate]:
        """The history entries this transaction wrote on the case by `author_id`
        (case_update and referral_update write their own), oldest first.
        Only meaningful inside a shared transaction (`within`)."""
        rows = await self._rows("case_list_updates_this_transaction", case_id=case_id, author_id=author_id)
        return [CaseUpdate(**row) for row in rows]

    async def recent_activity(self, limit: int) -> list[CaseUpdate]:
        return [CaseUpdate(**row) for row in await self._rows("case_recent_activity", limit=limit)]

    async def stats(self) -> CaseStats:
        return CaseStats(**await self._one("case_stats"))

    async def counts_by_category(self) -> list[CategoryCount]:
        return [CategoryCount(**row) for row in await self._rows("case_counts_by_category")]

    async def counts_by_status(self) -> list[StatusCount]:
        return [StatusCount(**row) for row in await self._rows("case_counts_by_status")]

    # --- Referrals (a case connected with a directory resource) -----------------

    async def list_referrals(self, case_id: UUID) -> list[Referral]:
        return [Referral(**row) for row in await self._rows("referral_list", case_id=case_id)]

    async def add_referral(
        self, case_id: UUID, resource_id: UUID, status: ReferralStatus, actor_id: UUID
    ) -> Referral | None:
        row = await self._first("referral_add", case_id=case_id, resource_id=resource_id, status=status,
                                actor_id=actor_id)
        return Referral(**row) if row else None

    async def update_referral(
        self, case_id: UUID, referral_id: UUID, status: ReferralStatus | None, outcome: str | None, actor_id: UUID
    ) -> Referral | None:
        row = await self._first("referral_update", case_id=case_id, referral_id=referral_id, status=status,
                                outcome=outcome, actor_id=actor_id)
        return Referral(**row) if row else None

    # --- The requester's view ----------------------------------------------------

    async def list_for_requester(self, user_id: UUID) -> list[PublicRequest]:
        return [PublicRequest(**row) for row in await self._rows("request_list_for_user", user_id=user_id)]

    async def get_for_requester(self, user_id: UUID, case_id: UUID) -> PublicRequest | None:
        row = await self._first("request_get_for_user", user_id=user_id, case_id=case_id)
        return PublicRequest(**row) if row else None

    async def get_by_code(self, number: int, access_code_hash: bytes) -> PublicRequest | None:
        row = await self._first("request_get_by_code", number=number, access_code_hash=access_code_hash)
        return PublicRequest(**row) if row else None

    async def list_public_updates_for_case(self, case_id: UUID) -> list[PublicRequestUpdate]:
        """For a caller already matched to the request (by account or code)."""
        rows = await self._rows("request_list_public_updates", case_id=case_id)
        return [PublicRequestUpdate(**row) for row in rows]

    async def add_reply(self, case_id: UUID, author_id: UUID | None, content: str) -> PublicRequestUpdate | None:
        row = await self._first("request_add_reply", case_id=case_id, author_id=author_id, content=content)
        return PublicRequestUpdate(**row) if row else None

    async def list_public_updates(self, user_id: UUID, case_id: UUID) -> list[PublicRequestUpdate]:
        rows = await self._rows("request_list_updates_for_user", user_id=user_id, case_id=case_id)
        return [PublicRequestUpdate(**row) for row in rows]
