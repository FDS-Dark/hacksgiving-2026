"""The case workflow: a request for help comes in (from the public, or a
worker opens it), and workers triage, assign, note, refer and resolve it.
The history of each change is written by the database functions themselves."""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from databridge.case import CaseDatabridge
from errors import ApiError, not_found
from models.case import (
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
)
from models.case_enums import CaseCategory, CasePriority
from models.staff import StaffMember
from models.user import AppUser
from services import access_code
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
    def __init__(
        self, cases: CaseDatabridge, resources: ResourceService, staff: StaffService, tasks: TaskService
    ) -> None:
        self.cases = cases
        self.resources = resources
        self.staff = staff
        self.tasks = tasks

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

    async def submit_anonymous_request(self, body: SubmitRequest, triage: Triager | None) -> AnonymousRequestReceipt:
        """A request from someone who isn't signed in (an emergency shouldn't
        wait on an account). The access code in the receipt, with the
        request's number, is how they get back to it."""
        code = access_code.new_code()
        code_hash = access_code.hash_code(code)
        case = await self._submit(body, triage, requester_id=None, access_code_hash=code_hash)
        logger.info("Request #%s submitted without an account", case.number)
        request = await self.cases.get_by_code(case.number, code_hash)
        if request is None:
            raise RuntimeError(f"Case {case.id} isn't readable with its access code")
        return AnonymousRequestReceipt(request=request, access_code=code)

    async def _submit(
        self, body: SubmitRequest, triage: Triager | None, *, requester_id: UUID | None, access_code_hash: bytes | None
    ) -> Case:
        guess: Triage | None = None
        if body.category is None and triage is not None:
            try:
                guess = await triage(body.description)
            except Exception:
                logger.exception("Triage failed; the request goes in uncategorized")
        category = body.category or (guess.category if guess else CaseCategory.OTHER)
        priority = CasePriority.HIGH if guess and guess.urgent else CasePriority.MEDIUM

        contact_method = body.contact_method
        case = await self.cases.create_request(
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
            await self.cases.add_update(
                case.id, None, UpdateType.NOTE, Visibility.INTERNAL,
                f"Auto-triage suggested {label}.{urgent} {guess.reason}".strip(),
            )
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
        reply = await self.cases.add_reply(case_id, author_id, body.content)
        if reply is None:
            raise not_found("request")
        return reply

    # --- Workers ---------------------------------------------------------------

    async def _check_assignee(self, worker_id: UUID | None) -> None:
        if worker_id is not None and not await self.staff.is_worker(worker_id):
            raise ApiError(422, "not_a_worker", "Cases can only be assigned to ComForce staff")

    async def create(self, worker: StaffMember, body: CreateCaseRequest) -> Case:
        await self._check_assignee(body.assigned_worker_id)
        case = await self.cases.create(
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

    async def detail(self, case_id: UUID) -> CaseDetail:
        case = await self.get(case_id)
        return CaseDetail(
            case=case,
            updates=await self.cases.list_updates(case_id),
            referrals=await self.cases.list_referrals(case_id),
            tasks=await self.tasks.for_case(case_id),
        )

    async def update(self, worker: StaffMember, case_id: UUID, changes: UpdateCaseRequest) -> Case:
        if not changes.model_fields_set:
            raise ApiError(422, "no_changes", "Send at least one field to change")
        await self._check_assignee(changes.assigned_worker_id)
        case = await self.cases.update(case_id, worker.id, changes)
        if case is None:
            raise not_found("case")
        return case

    async def add_update(self, worker: StaffMember, case_id: UUID, body: AddCaseUpdateRequest) -> CaseUpdate:
        update_type = UpdateType.MESSAGE if body.visibility == Visibility.PUBLIC else UpdateType.NOTE
        update = await self.cases.add_update(case_id, worker.id, update_type, body.visibility, body.content)
        if update is None:
            raise not_found("case")
        return update

    async def insights(self, activity_limit: int = 15) -> CaseInsights:
        return CaseInsights(
            stats=await self.cases.stats(),
            by_category=await self.cases.counts_by_category(),
            by_status=await self.cases.counts_by_status(),
            recent_activity=await self.cases.recent_activity(activity_limit),
        )

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
        referral = await self.cases.update_referral(case_id, referral_id, body.status, body.outcome, worker.id)
        if referral is None:
            raise not_found("referral")
        return referral
