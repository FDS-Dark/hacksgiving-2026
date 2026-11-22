"""The case workflow: a request for help comes in (from the public, or a
worker opens it), and workers triage, assign, note, refer and resolve it.
The history of each change is written by the database functions themselves."""

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from databridge.case import CaseDatabridge
from databridge.executor import FunctionCaller, Transactions
from errors import ApiError, not_found
from models.case import (
    CLOSED_STATUSES,
    AddCaseUpdateRequest,
    AddReferralRequest,
    AnonymousRequestReceipt,
    Case,
    CaseDetail,
    CaseFilters,
    CaseInsights,
    CaseSource,
    CaseUpdate,
    ContactMethod,
    CreateCaseRequest,
    Person,
    PersonMatch,
    PublicRequest,
    PublicRequestDetail,
    PublicRequestUpdate,
    Referral,
    ReplyRequest,
    SubmitRequest,
    UpdateCaseRequest,
    UpdateReferralRequest,
    UpdateType,
    Visibility,
    WorkedCase,
)
from models.case_enums import CaseCategory, CasePriority, pages_on_call
from models.notification import NotificationKind
from models.oncall import AlertStatus
from models.staff import StaffMember
from models.user import AppUser
from services import access_code
from services.notification import NotificationService
from services.oncall import OncallService
from services.resource import ResourceService
from services.staff import StaffService
from services.task import TaskService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Triage:
    """A first guess at a new request, for workers to confirm."""

    category: CaseCategory
    urgent: bool
    reason: str


# Reads a request's text and guesses its category; None when it can't.
Triager = Callable[[str], Awaitable[Triage | None]]

TITLE_LENGTH = 80


def blank_to_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def title_from(description: str) -> str:
    """The first line of the description, cut at a word near TITLE_LENGTH."""
    text = description.strip()
    line = text.splitlines()[0].strip() if text else "Request for help"
    if len(line) <= TITLE_LENGTH:
        return line
    cut = line[:TITLE_LENGTH].rsplit(" ", 1)[0]
    return (cut or line[:TITLE_LENGTH]).rstrip(",.;:") + "…"


class CaseService:
    """Changes that notify someone (an assignment, a reply, a message or
    status change for the requester, a referral's status) write the change
    and its notification in one transaction: `self.cases.within(tx)` and
    `notifications.notify(tx, ...)` share it. Nobody is notified of their
    own action.

    A write that can make a case page on call (it is open, unassigned and
    high or critical: `pages_on_call`) opens its alert in the same
    transaction (`oncall.open_for_case`); one that assigns or closes it ends
    the alert (`oncall.resolve_for_case`)."""

    def __init__(
        self,
        cases: CaseDatabridge,
        resources: ResourceService,
        staff: StaffService,
        tasks: TaskService,
        notifications: NotificationService,
        transactions: Transactions,
        oncall: OncallService,
    ) -> None:
        self.cases = cases
        self.resources = resources
        self.staff = staff
        self.tasks = tasks
        self.notifications = notifications
        self.transactions = transactions
        self.oncall = oncall

    # --- Public: the person asking for help ------------------------------------

    async def submit_request(self, user: AppUser, body: SubmitRequest, triage: Triager | None) -> PublicRequest:
        """A signed-in member's request. Its priority, status and assignee
        are for workers to set. An optional triager suggests a category and
        flags urgency; it never blocks the submission."""
        case = await self._submit(body, triage, requester_id=user.id, access_code_hash=None)
        logger.info("Request #%s submitted by user %s", case.number, user.id)
        request = await self.cases.get_for_requester(user.id, case.id)
        if request is None:
            raise RuntimeError(f"Case {case.id} isn't visible to its requester")
        return request

    async def submit_anonymous_request(
        self, body: SubmitRequest, triage: Triager | None, *, urgent_note: str | None = None
    ) -> AnonymousRequestReceipt:
        """A request from someone who isn't signed in (an emergency shouldn't
        wait on an account). The access code in the receipt, with the
        request's number, is how they get back to it.

        `urgent_note` is for a trusted caller that has already judged the
        request urgent (the phone agent): the case goes in at high
        priority, which pages on call, with the note in its history. A
        resident's own form can't set it."""
        code = access_code.new_code()
        code_hash = access_code.hash_code(code)
        case = await self._submit(
            body, triage, requester_id=None, access_code_hash=code_hash, urgent_note=urgent_note
        )
        logger.info("Request #%s submitted without an account", case.number)
        request = await self.cases.get_by_code(case.number, code_hash)
        if request is None:
            raise RuntimeError(f"Case {case.id} isn't readable with its access code")
        return AnonymousRequestReceipt(request=request, access_code=code)

    async def _submit(
        self,
        body: SubmitRequest,
        triage: Triager | None,
        *,
        requester_id: UUID | None,
        access_code_hash: bytes | None,
        urgent_note: str | None = None,
    ) -> Case:
        """The triage (an AI call) runs first, outside any transaction; then
        the case, its triage note and its on-call alert are one transaction.
        The tasks come after the commit: a failure there never loses the
        request."""
        guess: Triage | None = None
        if body.category is None and triage is not None:
            try:
                guess = await triage(body.description)
            except Exception:
                logger.exception("Triage failed; the request goes in uncategorized")
        category = body.category or (guess.category if guess else CaseCategory.OTHER)
        is_urgent = urgent_note is not None or bool(guess and guess.urgent)
        priority = CasePriority.HIGH if is_urgent else CasePriority.MEDIUM

        contact_method = body.contact_method
        async with self.transactions.transaction() as tx:
            cases = self.cases.within(tx)
            case = await cases.create_request(
                title=body.title or title_from(body.description),
                description=body.description,
                category=category,
                priority=priority,
                location=blank_to_none(body.location),
                latitude=body.latitude,
                longitude=body.longitude,
                contact_name=blank_to_none(body.contact_name),
                # "Don't contact me" means no number is kept either.
                contact_phone=None if contact_method == ContactMethod.NONE else blank_to_none(body.contact_phone),
                contact_email=None if contact_method == ContactMethod.NONE else blank_to_none(body.contact_email),
                contact_method=contact_method,
                safe_to_contact=None if contact_method == ContactMethod.NONE else body.safe_to_contact,
                requester_id=requester_id,
                access_code_hash=access_code_hash,
            )
            if guess:
                urgent = " Flagged urgent." if guess.urgent else ""
                label = guess.category.value.replace("_", " ")
                await cases.add_update(
                    case.id, None, UpdateType.NOTE, Visibility.INTERNAL,
                    f"Suggested type of help: {label}.{urgent} {guess.reason}".strip(),
                )
            if urgent_note:
                await cases.add_update(case.id, None, UpdateType.NOTE, Visibility.INTERNAL, urgent_note)
            await self.oncall.open_for_case(tx, case)
        await self.tasks.generate_for(case)
        return case

    async def my_requests(self, user: AppUser) -> list[PublicRequest]:
        return await self.cases.list_for_requester(user.id)

    async def my_request(self, user: AppUser, case_id: UUID) -> PublicRequestDetail:
        request = await self.cases.get_for_requester(user.id, case_id)
        if request is None:
            raise not_found("request")
        return PublicRequestDetail(request=request, updates=await self.cases.list_public_updates(user.id, case_id))

    async def reply(self, user: AppUser, case_id: UUID, body: ReplyRequest) -> PublicRequestUpdate:
        """The member answers on their own request."""
        if await self.cases.get_for_requester(user.id, case_id) is None:
            raise not_found("request")
        return await self._add_reply(case_id, user.id, body)

    async def request_by_code(self, number: int, code: str) -> PublicRequestDetail:
        """A request sent without an account, for whoever holds its code.
        A wrong number or code is the same 404, so neither can be probed."""
        request = await self._by_code(number, code)
        return PublicRequestDetail(request=request, updates=await self.cases.list_public_updates_for_case(request.id))

    async def reply_by_code(self, number: int, code: str, body: ReplyRequest) -> PublicRequestUpdate:
        request = await self._by_code(number, code)
        return await self._add_reply(request.id, None, body)

    async def _by_code(self, number: int, code: str) -> PublicRequest:
        request = await self.cases.get_by_code(number, access_code.hash_code(code)) if code.strip() else None
        if request is None:
            raise not_found("request")
        return request

    async def _add_reply(self, case_id: UUID, author_id: UUID | None, body: ReplyRequest) -> PublicRequestUpdate:
        """The reply, and a notification for whoever holds the case (none
        when nobody does)."""
        async with self.transactions.transaction() as tx:
            cases = self.cases.within(tx)
            reply = await cases.add_reply(case_id, author_id, body.content)
            if reply is None:
                raise not_found("request")
            case = await cases.get(case_id)
            await self.notifications.notify(
                tx, user_id=case.assigned_worker_id if case else None, kind=NotificationKind.REPLY,
                dedupe_key=f"reply:{reply.id}", actor_id=author_id, case_id=case_id, case_update_id=reply.id,
            )
        return reply

    # --- Workers ---------------------------------------------------------------

    async def _check_assignee(self, worker_id: UUID | None) -> None:
        if worker_id is not None and not await self.staff.is_worker(worker_id):
            raise ApiError(422, "not_a_worker", "Cases can only be assigned to ComForce staff")

    async def create(self, worker: StaffMember, body: CreateCaseRequest) -> Case:
        """A case staff open (also a confirmed Phantom record, which is
        assigned to its author and so doesn't page)."""
        await self._check_assignee(body.assigned_worker_id)
        async with self.transactions.transaction() as tx:
            case = await self.cases.within(tx).create(
                kind=body.kind,
                title=body.title,
                description=body.description,
                category=body.category,
                priority=body.priority,
                source=CaseSource.WORKER,
                location=blank_to_none(body.location),
                latitude=body.latitude,
                longitude=body.longitude,
                contact_name=blank_to_none(body.contact_name),
                contact_phone=blank_to_none(body.contact_phone),
                contact_email=blank_to_none(body.contact_email),
                requester_id=None,
                assigned_worker_id=body.assigned_worker_id,
                created_by=worker.id,
            )
            await self.oncall.open_for_case(tx, case)
        logger.info("Case #%s opened by worker %s", case.number, worker.id)
        await self.tasks.generate_for(case)
        return case

    async def search(self, filters: CaseFilters) -> list[Case]:
        return await self.cases.search(filters)

    async def get(self, case_id: UUID) -> Case:
        case = await self.cases.get(case_id)
        if case is None:
            raise not_found("case")
        return case

    async def person(self, case_id: UUID, limit: int = 50) -> Person:
        """The resident behind a case and all their cases (0024: same account,
        phone or email). Contact details come from their newest case that
        has each one."""
        anchor = await self.get(case_id)
        cases = await self.cases.person_cases(case_id, limit)
        if not cases:  # pragma: no cover - the case itself always matches
            cases = [anchor]

        def digits(phone: str | None) -> str | None:
            d = re.sub(r"\D", "", phone or "")
            return d[-10:] if len(d) >= 7 else None

        matched: list[PersonMatch] = []
        others = [c for c in cases if c.id != anchor.id]
        if anchor.requester_id and any(c.requester_id == anchor.requester_id for c in others):
            matched.append(PersonMatch.ACCOUNT)
        phone = digits(anchor.contact_phone)
        if phone and any(digits(c.contact_phone) == phone for c in others):
            matched.append(PersonMatch.PHONE)
        email = (anchor.contact_email or "").strip().lower()
        if email and any((c.contact_email or "").strip().lower() == email for c in others):
            matched.append(PersonMatch.EMAIL)

        def newest(field: str) -> object:
            return next((getattr(c, field) for c in cases if getattr(c, field) not in (None, "")), None)

        return Person(
            name=newest("contact_name"),
            phone=newest("contact_phone"),
            email=newest("contact_email"),
            contact_method=newest("contact_method"),
            safe_to_contact=anchor.safe_to_contact,
            has_account=any(c.requester_id for c in cases),
            matched_by=matched,
            first_contact_at=min(c.created_at for c in cases),
            last_activity_at=max(c.last_activity_at for c in cases),
            open_cases=sum(1 for c in cases if c.status not in CLOSED_STATUSES),
            cases=cases,
        )

    async def detail(self, case_id: UUID) -> CaseDetail:
        case = await self.get(case_id)
        return CaseDetail(
            case=case,
            updates=await self.cases.list_updates(case_id),
            referrals=await self.cases.list_referrals(case_id),
            tasks=await self.tasks.for_case(case_id),
        )

    async def update(self, worker: StaffMember, case_id: UUID, changes: UpdateCaseRequest) -> Case:
        if not changes.model_fields_set - {"handoff_note"}:
            raise ApiError(422, "no_changes", "Send at least one field to change")
        if changes.handoff_note and "assigned_worker_id" not in changes.model_fields_set:
            raise ApiError(422, "handoff_without_reassign", "A handoff note goes with a change of owner")
        await self._check_assignee(changes.assigned_worker_id)
        async with self.transactions.transaction() as tx:
            case = await self.cases.within(tx).update(case_id, worker.id, changes)
            if case is None:
                raise not_found("case")
            if changes.model_fields_set & {"assigned_worker_id", "status"}:
                await self._notify_changes(tx, worker.id, case, changes.handoff_note)
            if changes.model_fields_set & {"assigned_worker_id", "status", "priority"}:
                await self._sync_alert(tx, case)
        return case

    async def _sync_alert(self, tx: FunctionCaller, case: Case) -> None:
        """After a change of assignee, status or priority: a case that now
        pages gets an alert (priority raised, unassigned, reopened); one that
        doesn't ends its open alert, `resolved` when someone was assigned by
        hand and `cancelled` otherwise (closed, or no longer urgent)."""
        if pages_on_call(case):
            await self.oncall.open_for_case(tx, case)
        elif case.assigned_worker_id is not None and case.status not in CLOSED_STATUSES:
            await self.oncall.resolve_for_case(tx, case.id, AlertStatus.RESOLVED)
        else:
            await self.oncall.resolve_for_case(tx, case.id, AlertStatus.CANCELLED)

    async def _notify_changes(
        self, tx: FunctionCaller, actor_id: UUID, case: Case, handoff_note: str | None = None
    ) -> None:
        """case_update writes a history entry for each real change (none for
        re-assigning the same person): the new assignee hears of an
        assignment, the requester of a status change. A handoff note sent
        with a real reassignment is saved as an internal note, and the new
        owner's notification points at it so they read it first."""
        cases = self.cases.within(tx)
        for entry in await cases.updates_this_transaction(case.id, actor_id):
            if entry.update_type == UpdateType.ASSIGNMENT:
                await self.tasks.remind_new_case_owner(tx, case.id)
                user_id, kind, key = case.assigned_worker_id, NotificationKind.ASSIGNMENT, f"assignment:{entry.id}"
                if handoff_note and case.assigned_worker_id is not None:
                    note = await cases.add_update(
                        case.id, actor_id, UpdateType.NOTE, Visibility.INTERNAL, f"Handoff note: {handoff_note}"
                    )
                    if note is not None:
                        await self.notifications.notify(
                            tx, user_id=user_id, kind=kind, dedupe_key=key, actor_id=actor_id, case_id=case.id,
                            case_update_id=note.id,
                        )
                        continue
            elif entry.update_type == UpdateType.STATUS_CHANGE:
                user_id, kind, key = case.requester_id, NotificationKind.REQUEST_UPDATE, f"update:{entry.id}"
            else:
                continue
            await self.notifications.notify(
                tx, user_id=user_id, kind=kind, dedupe_key=key, actor_id=actor_id, case_id=case.id,
                case_update_id=entry.id,
            )

    async def add_update(self, worker: StaffMember, case_id: UUID, body: AddCaseUpdateRequest) -> CaseUpdate:
        """A note, or a message the requester sees (and is notified of, if
        they have an account)."""
        update_type = UpdateType.MESSAGE if body.visibility == Visibility.PUBLIC else UpdateType.NOTE
        async with self.transactions.transaction() as tx:
            cases = self.cases.within(tx)
            update = await cases.add_update(case_id, worker.id, update_type, body.visibility, body.content)
            if update is None:
                raise not_found("case")
            if body.visibility == Visibility.PUBLIC:
                case = await cases.get(case_id)
                await self.notifications.notify(
                    tx, user_id=case.requester_id if case else None, kind=NotificationKind.REQUEST_UPDATE,
                    dedupe_key=f"update:{update.id}", actor_id=worker.id, case_id=case_id, case_update_id=update.id,
                )
        return update

    async def insights(self, activity_limit: int = 15) -> CaseInsights:
        return CaseInsights(
            stats=await self.cases.stats(),
            by_category=await self.cases.counts_by_category(),
            by_status=await self.cases.counts_by_status(),
            recent_activity=await self.cases.recent_activity(activity_limit),
        )

    async def recently_worked(self, worker: StaffMember, limit: int) -> list[WorkedCase]:
        """The cases this worker touched most recently: for finding a case
        again after an interruption."""
        return await self.cases.recently_worked(worker.id, limit)

    async def recent_activity(self, limit: int) -> list[CaseUpdate]:
        return await self.cases.recent_activity(limit)

    # --- Referrals -----------------------------------------------------------------

    async def add_referral(self, worker: StaffMember, case_id: UUID, body: AddReferralRequest) -> Referral:
        await self.get(case_id)
        await self.resources.get(body.resource_id)
        referral = await self.cases.add_referral(case_id, body.resource_id, body.status, worker.id)
        if referral is None:
            raise ApiError(409, "already_referred", "That resource is already on this case")
        return referral

    async def update_referral(
        self, worker: StaffMember, case_id: UUID, referral_id: UUID, body: UpdateReferralRequest
    ) -> Referral:
        async with self.transactions.transaction() as tx:
            cases = self.cases.within(tx)
            before = None
            if body.status is not None:
                before = next((r.status for r in await cases.list_referrals(case_id) if r.id == referral_id), None)
            referral = await cases.update_referral(case_id, referral_id, body.status, body.outcome, worker.id)
            if referral is None:
                raise not_found("referral")
            if before is not None and referral.status != before:
                await self._notify_referral(tx, worker.id, referral)
        return referral

    async def _notify_referral(self, tx: FunctionCaller, actor_id: UUID, referral: Referral) -> None:
        """The case's assignee hears of the referral's new status. The key is
        the status change's history entry (referral_update writes it first).
        No entry means this request didn't change the status (a concurrent
        one did, and notified), so nothing is sent."""
        cases = self.cases.within(tx)
        entries = [
            e for e in await cases.updates_this_transaction(referral.case_id, actor_id)
            if e.update_type == UpdateType.REFERRAL
        ]
        if not entries:
            return
        case = await cases.get(referral.case_id)
        await self.notifications.notify(
            tx, user_id=case.assigned_worker_id if case else None, kind=NotificationKind.REFERRAL_UPDATE,
            dedupe_key=f"referral:{entries[0].id}", actor_id=actor_id, case_id=referral.case_id,
            case_update_id=entries[0].id, referral_id=referral.id,
        )
