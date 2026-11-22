"""Partner organizations, and sharing a case with one (Figma P1, P2).

Sharing needs the resident's consent, recorded with how it was given. The
share goes in the case's history (internal) in the same transaction, so the
record of who was told what never depends on the app. The API doesn't send
anything to the partner itself: it returns the message (the summary, plus
only what the resident agreed to) for the worker to send from their own
email or phone, and keeps the share until someone revokes it.

Asking a partner for help with a case (a request, not a share) sends only
the need, the worker's note, the case number and the worker's name. The
person's name and phone, or location, go only when the case has a live
consented share with that partner that included them. Partners have no
accounts: with texts set up and a textable partner number, the worker's
upkeep texts it (PartnerTexter); otherwise the app opens the worker's own
email or phone with the message. Either way the case's history says who
asked whom for what, and when."""

import logging
from uuid import UUID

from adapters.sms import SmsSender, us_number

from databridge.case import CaseDatabridge
from databridge.executor import Transactions
from databridge.partner import PartnerDatabridge
from errors import ApiError, not_found
from models.case import Case, UpdateType, Visibility
from models.case_enums import CaseCategory
from models.partner import (
    CaseShare,
    ConsentMethod,
    CreatePartnerRequest,
    CreateShareRequest,
    Partner,
    PartnerBody,
    PartnerRequest,
    PartnerRequestDelivery,
    PartnerRequestStatus,
    SentPartnerRequest,
    SharedCase,
)
from models.staff import StaffMember

logger = logging.getLogger(__name__)

CONSENT_WORDS = {
    ConsentMethod.VERBAL: "told a worker",
    ConsentMethod.WRITTEN: "signed a release",
    ConsentMethod.IN_APP: "agreed in the app",
}
CATEGORY_WORDS = {
    CaseCategory.HOMELESSNESS: "Housing and shelter",
    CaseCategory.MISSING_PERSONS: "Missing person",
    CaseCategory.MEAL_PROGRAMS: "Food",
    CaseCategory.VIOLENCE_PREVENTION: "Violence prevention",
    CaseCategory.TRANSPORTATION: "Transportation",
    CaseCategory.INCIDENT_DEESCALATION: "De-escalation",
    CaseCategory.BURIAL_ASSISTANCE: "Burial assistance",
    CaseCategory.BRIDGE_TO_EMPLOYMENT: "Employment",
    CaseCategory.OTHER: "Other",
}


def share_message(case: Case, share: CaseShare, worker: StaffMember) -> tuple[str, str]:
    """The subject and body for the partner. The summary always; name,
    phone and location only when the resident agreed to them."""
    lines = [
        f"Hello {share.partner_name},",
        "",
        f"ComForce MKE is sharing case #{case.number} with you, with the person's consent.",
        "",
        f"Why: {share.purpose}",
        f"Need: {CATEGORY_WORDS[case.category]}",
        f"Summary: {case.description.strip() or case.title}",
    ]
    if share.include_location and case.location:
        lines.append(f"Location: {case.location}")
    if share.include_contact:
        if case.contact_name:
            lines.append(f"Name: {case.contact_name}")
        if case.contact_phone:
            careful = "" if case.safe_to_contact is not False else (
                " (not safe to leave a message; don't say why you're calling to anyone else)"
            )
            lines.append(f"Phone: {case.contact_phone}{careful}")
    lines += [
        "",
        "Please don't share this further, and let us know if you can't help.",
        "",
        f"{worker.display_name}, ComForce MKE",
    ]
    return f"ComForce MKE referral: case #{case.number}", "\n".join(lines)


def request_message(
    case: Case, partner: Partner, worker: StaffMember, need: CaseCategory, note: str, share: CaseShare | None
) -> tuple[str, str]:
    """The subject and text for a request for help. Contact details and the
    location only as far as a live share with this partner allows."""
    lines = [
        f"Hello {partner.contact_name or partner.name},",
        "",
        f"ComForce MKE is asking for your help with case #{case.number}.",
        f"Need: {CATEGORY_WORDS[need]}",
        note,
    ]
    if share is not None and share.include_location and case.location:
        lines.append(f"Location: {case.location}")
    if share is not None and share.include_contact:
        if case.contact_name:
            lines.append(f"Name: {case.contact_name}")
        if case.contact_phone:
            lines.append(f"Phone: {case.contact_phone}")
    lines += ["", f"Please reply to {worker.display_name}, ComForce MKE."]
    return f"ComForce MKE: help with case #{case.number}", "\n".join(lines)


class PartnerService:
    def __init__(
        self, partners: PartnerDatabridge, cases: CaseDatabridge, transactions: Transactions, *,
        sms_enabled: bool = False,
    ) -> None:
        self.partners = partners
        self.cases = cases
        self.transactions = transactions
        # Texts can go out from the worker (APP__SMS__PROVIDER); else requests are composed on the phone.
        self.sms_enabled = sms_enabled

    async def search(self, q: str | None, category: CaseCategory | None, include_inactive: bool) -> list[Partner]:
        return await self.partners.search((q or "").strip() or None, category, include_inactive)

    async def get(self, partner_id: UUID) -> Partner:
        partner = await self.partners.get(partner_id)
        if partner is None:
            raise not_found("partner")
        return partner

    async def create(self, worker: StaffMember, body: PartnerBody) -> Partner:
        return await self.partners.create(body, worker.id)

    async def update(self, partner_id: UUID, body: PartnerBody) -> Partner:
        partner = await self.partners.update(partner_id, body)
        if partner is None:
            raise not_found("partner")
        return partner

    # --- Sharing a case ------------------------------------------------------------

    async def _case(self, case_id: UUID) -> Case:
        case = await self.cases.get(case_id)
        if case is None:
            raise not_found("case")
        return case

    async def shares(self, case_id: UUID) -> list[CaseShare]:
        await self._case(case_id)
        return await self.partners.shares(case_id)

    async def share(self, worker: StaffMember, case_id: UUID, body: CreateShareRequest) -> SharedCase:
        if not body.consent:
            raise ApiError(422, "consent_required", "Share a case only after the person agrees to it")
        case = await self._case(case_id)
        partner = await self.get(body.partner_id)
        if not partner.active or not partner.accepts_shares:
            raise ApiError(409, "partner_not_accepting", f"{partner.name} hasn't agreed to receive shared cases")
        async with self.transactions.transaction() as tx:
            share = await self.partners.within(tx).share(
                case_id=case_id, partner_id=partner.id, shared_by=worker.id, purpose=body.purpose,
                include_contact=body.include_contact, include_location=body.include_location,
                consent_method=body.consent_method, consent_note=body.consent_note,
            )
            if share is None:
                raise ApiError(409, "already_shared", f"This case is already shared with {partner.name}")
            extras = [word for word, on in (("name and phone", body.include_contact),
                                            ("location", body.include_location)) if on]
            included = "the summary" + (" and " + " and ".join(extras) if extras else "")
            await self.cases.within(tx).add_update(
                case_id, worker.id, UpdateType.NOTE, Visibility.INTERNAL,
                f"Shared with {partner.name} ({included}). The person {CONSENT_WORDS[body.consent_method]}"
                + (f": {body.consent_note}" if body.consent_note else "") + f". Why: {body.purpose}",
            )
        subject, message = share_message(case, share, worker)
        return SharedCase(share=share, subject=subject, message=message)

    async def revoke(self, worker: StaffMember, case_id: UUID, share_id: UUID) -> CaseShare:
        async with self.transactions.transaction() as tx:
            share = await self.partners.within(tx).revoke(case_id, share_id, worker.id)
            if share is None:
                raise not_found("share")
            await self.cases.within(tx).add_update(
                case_id, worker.id, UpdateType.NOTE, Visibility.INTERNAL,
                f"Stopped sharing with {share.partner_name}. Let them know they shouldn't use it further.",
            )
        return share

    # --- Asking a partner for help ----------------------------------------------------

    async def requests(self, case_id: UUID) -> list[PartnerRequest]:
        await self._case(case_id)
        return await self.partners.requests(case_id)

    async def request_help(self, worker: StaffMember, case_id: UUID, body: CreatePartnerRequest) -> SentPartnerRequest:
        case = await self._case(case_id)
        partner = await self.get(body.partner_id)
        if not partner.active:
            raise ApiError(409, "partner_inactive", f"{partner.name} is no longer an active partner")
        # The share-consent check: only a live share with this partner lets contact details or the location go.
        share = next((s for s in await self.partners.shares(case_id)
                      if s.partner_id == partner.id and s.revoked_at is None), None)
        subject, message = request_message(case, partner, worker, body.need, body.note, share)
        texts = self.sms_enabled and us_number(partner.phone) is not None
        request = await self.partners.request_help(
            case_id=case_id, partner_id=partner.id, requested_by=worker.id, need=body.need, note=body.note,
            message=message, delivery=PartnerRequestDelivery.SMS if texts else PartnerRequestDelivery.COMPOSE,
            included_contact=bool(share and share.include_contact and (case.contact_name or case.contact_phone)),
            included_location=bool(share and share.include_location and case.location),
        )
        if request is None:
            raise not_found("partner")
        return SentPartnerRequest(request=request, subject=subject, message=message)


class PartnerTexter:
    """Texts pending requests for help to partners, from the worker's upkeep."""

    def __init__(self, partners: PartnerDatabridge, sender: SmsSender, *, batch: int = 20) -> None:
        self.partners = partners
        self.sender = sender
        self.batch = batch

    async def sweep(self) -> int:
        """Handles up to `batch` pending requests. Returns how many were sent."""
        sent = 0
        for item in await self.partners.pending_texts(self.batch):
            to = us_number(item.partner_phone)
            if to is None:
                await self.partners.mark_text(item.id, PartnerRequestStatus.FAILED, "invalid_number", None)
                continue
            result = await self.sender.send(to, item.message)
            if result.retry:
                logger.warning("Partner request %s not texted yet: %s", item.id, result.reason)
                continue  # next round
            status = PartnerRequestStatus.SENT if result.sent else PartnerRequestStatus.FAILED
            await self.partners.mark_text(item.id, status, result.reason, result.provider_id)
            sent += result.sent
        return sent
