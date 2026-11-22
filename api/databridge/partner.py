"""Partners, case shares (0021_partners_and_outreach.sql) and requests for
help sent to partners (0031_team_chat_and_delivery.sql)."""

from uuid import UUID

from databridge.base import Databridge
from models.case_enums import CaseCategory
from models.partner import (
    CaseShare,
    ConsentMethod,
    Partner,
    PartnerBody,
    PartnerRequest,
    PartnerRequestDelivery,
    PartnerRequestStatus,
    PendingPartnerText,
)


def _fields(body: PartnerBody) -> dict[str, object]:
    return {
        "name": body.name, "description": body.description, "categories": [c.value for c in body.categories],
        "contact_name": body.contact_name, "phone": body.phone, "email": body.email, "website": body.website,
        "address": body.address, "languages": body.languages, "accepts_shares": body.accepts_shares,
        "notes": body.notes, "active": body.active,
    }


class PartnerDatabridge(Databridge):
    async def search(self, q: str | None, category: CaseCategory | None, include_inactive: bool) -> list[Partner]:
        rows = await self._rows("partner_list", q=q, category=category, include_inactive=include_inactive)
        return [Partner(**row) for row in rows]

    async def get(self, partner_id: UUID) -> Partner | None:
        row = await self._first("partner_get", partner_id=partner_id)
        return Partner(**row) if row else None

    async def create(self, body: PartnerBody, created_by: UUID) -> Partner:
        return Partner(**await self._one("partner_create", **_fields(body), created_by=created_by))

    async def update(self, partner_id: UUID, body: PartnerBody) -> Partner | None:
        row = await self._first("partner_update", partner_id=partner_id, **_fields(body))
        return Partner(**row) if row else None

    async def share(
        self, *, case_id: UUID, partner_id: UUID, shared_by: UUID, purpose: str, include_contact: bool,
        include_location: bool, consent_method: ConsentMethod, consent_note: str | None,
    ) -> CaseShare | None:
        row = await self._first(
            "case_share_create", case_id=case_id, partner_id=partner_id, shared_by=shared_by, purpose=purpose,
            include_contact=include_contact, include_location=include_location, consent_method=consent_method,
            consent_note=consent_note,
        )
        return CaseShare(**row) if row else None

    async def shares(self, case_id: UUID) -> list[CaseShare]:
        return [CaseShare(**row) for row in await self._rows("case_share_list", case_id=case_id)]

    async def revoke(self, case_id: UUID, share_id: UUID, revoked_by: UUID) -> CaseShare | None:
        row = await self._first("case_share_revoke", case_id=case_id, share_id=share_id, revoked_by=revoked_by)
        return CaseShare(**row) if row else None

    async def request_help(
        self, *, case_id: UUID, partner_id: UUID, requested_by: UUID, need: CaseCategory, note: str, message: str,
        delivery: PartnerRequestDelivery, included_contact: bool, included_location: bool,
    ) -> PartnerRequest | None:
        """The request and its line on the case's history. None when the case
        or an active partner is missing."""
        row = await self._first(
            "partner_request_create", case_id=case_id, partner_id=partner_id, requested_by=requested_by, need=need,
            note=note, message=message, delivery=delivery, included_contact=included_contact,
            included_location=included_location,
        )
        return PartnerRequest(**row) if row else None

    async def requests(self, case_id: UUID) -> list[PartnerRequest]:
        return [PartnerRequest(**row) for row in await self._rows("partner_request_list", case_id=case_id)]

    async def pending_texts(self, limit: int) -> list[PendingPartnerText]:
        return [PendingPartnerText(**row) for row in await self._rows("partner_request_pending", limit=limit)]

    async def mark_text(
        self, request_id: UUID, status: PartnerRequestStatus, reason: str | None, provider_id: str | None
    ) -> PartnerRequest | None:
        row = await self._first(
            "partner_request_mark", request_id=request_id, status=status, reason=reason, provider_id=provider_id
        )
        return PartnerRequest(**row) if row else None
