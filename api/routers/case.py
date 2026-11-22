"""The worker case API: ComForce staff only (403 for everyone else)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from dependencies import (
    get_case_assistant,
    get_case_service,
    get_current_worker,
    get_resource_service,
    get_task_service,
)
from models.assist import (
    LANGUAGES,
    CaseLanguage,
    CaseSummary,
    DraftMessage,
    DraftMessageRequest,
    LanguageOption,
    ResourceSuggestions,
    SetCaseLanguageRequest,
    TranslateRequest,
    Translation,
)
from models.case import (
    AddCaseUpdateRequest,
    AddReferralRequest,
    Case,
    Person,
    CaseDetail,
    CaseFilters,
    CaseInsights,
    CaseUpdate,
    CreateCaseRequest,
    Referral,
    UpdateCaseRequest,
    UpdateReferralRequest,
)
from models.staff import StaffMember
from models.task import CreateTaskRequest, Task
from services import case_assist
from services.case import CaseService
from services.case_assist import CaseAssistant
from services.resource import ResourceService
from services.task import TaskService

router = APIRouter(prefix="/cases", tags=["cases"])


@router.get("", response_model=list[Case])
async def list_cases(
    filters: Annotated[CaseFilters, Query()],
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> list[Case]:
    """The case queue. Filters combine; open cases first, then by priority
    (critical first), then newest. `q` matches the case number, title,
    description or location."""
    return await service.search(filters)


@router.post("", response_model=Case, status_code=status.HTTP_201_CREATED)
async def create_case(
    body: CreateCaseRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> Case:
    """A case a worker opens: a phone call, a walk-in, an incident."""
    return await service.create(worker, body)


# Declared before /{case_id} so the path isn't read as a case id.
@router.get("/insights", response_model=CaseInsights)
async def case_insights(
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> CaseInsights:
    """Dashboard numbers, counted from the cases themselves."""
    return await service.insights()


@router.get("/activity", response_model=list[CaseUpdate])
async def recent_activity(
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> list[CaseUpdate]:
    """The latest updates across all cases, newest first."""
    return await service.recent_activity(limit)


@router.get("/languages", response_model=list[LanguageOption])
async def reply_languages(_: StaffMember = Depends(get_current_worker)) -> list[LanguageOption]:
    """The languages staff can reply to residents in."""
    return [LanguageOption(code=code, name=name) for code, name in LANGUAGES.items()]


@router.get("/{case_id}", response_model=CaseDetail)
async def get_case(
    case_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> CaseDetail:
    """A case with its full history and referrals."""
    return await service.detail(case_id)


@router.get("/{case_id}/person", response_model=Person)
async def get_case_person(
    case_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> Person:
    """The resident behind a case: their contact details and every case that
    looks like the same person (same resident account, phone number or
    email). Staff only."""
    return await service.person(case_id)


@router.patch("/{case_id}", response_model=Case)
async def update_case(
    case_id: UUID,
    body: UpdateCaseRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> Case:
    """Triage and progress: status, priority, category, assignee (null to
    unassign) and details. Each change is recorded in the history."""
    return await service.update(worker, case_id, body)


@router.post("/{case_id}/updates", response_model=CaseUpdate, status_code=status.HTTP_201_CREATED)
async def add_case_update(
    case_id: UUID,
    body: AddCaseUpdateRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> CaseUpdate:
    """An internal note (default), or with `visibility: public` a message
    the requester sees on their request."""
    return await service.add_update(worker, case_id, body)


@router.post("/{case_id}/tasks", response_model=Task, status_code=status.HTTP_201_CREATED)
async def add_task(
    case_id: UUID,
    body: CreateTaskRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: TaskService = Depends(get_task_service),
) -> Task:
    """Add a task to the case, optionally due at a time and assigned to a
    worker (422 if they aren't staff). Without an assignee it follows the
    case. Noted in the case history."""
    return await service.add(worker, case_id, body)


@router.post("/{case_id}/referrals", response_model=Referral, status_code=status.HTTP_201_CREATED)
async def add_referral(
    case_id: UUID,
    body: AddReferralRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> Referral:
    """Connect the case with a community resource. 409 if it's already on it."""
    return await service.add_referral(worker, case_id, body)


@router.patch("/{case_id}/referrals/{referral_id}", response_model=Referral)
async def update_referral(
    case_id: UUID,
    referral_id: UUID,
    body: UpdateReferralRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> Referral:
    """Track a referral: suggested, shared, accepted, completed or declined,
    and record its outcome."""
    return await service.update_referral(worker, case_id, referral_id, body)


# --- AI assistance (suggestions only; nothing here changes the case) -------------


@router.post("/{case_id}/assist/summary", response_model=CaseSummary)
async def summarize_case(
    case_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
    assistant: CaseAssistant | None = Depends(get_case_assistant),
) -> CaseSummary:
    """A short summary of the case and its history. 503 when AI isn't configured."""
    return await case_assist.summarize(service, assistant, case_id)


@router.post("/{case_id}/assist/resources", response_model=ResourceSuggestions)
async def suggest_resources(
    case_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
    resources: ResourceService = Depends(get_resource_service),
    assistant: CaseAssistant | None = Depends(get_case_assistant),
) -> ResourceSuggestions:
    """Resources that fit the case, each with a reason, chosen only from the
    resource directory. Without AI (`method: rules`), the resources in the
    case's category."""
    return await case_assist.suggest_resources(service, resources, assistant, case_id)


@router.get("/{case_id}/language", response_model=CaseLanguage)
async def get_case_language(
    case_id: UUID,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> CaseLanguage:
    """The language staff reply to the resident in (set by a worker, or
    noticed by the AI draft). `language: null` means not set."""
    return await case_assist.case_language(service, case_id)


@router.put("/{case_id}/language", response_model=CaseLanguage)
async def set_case_language(
    case_id: UUID,
    body: SetCaseLanguageRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
) -> CaseLanguage:
    """Choose the reply language (a code from `GET /cases/languages`; null
    clears it). A worker's choice is never replaced by detection."""
    return await case_assist.set_case_language(service, worker, case_id, body)


@router.post("/{case_id}/assist/translate", response_model=Translation)
async def translate_message(
    case_id: UUID,
    body: TranslateRequest,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
    assistant: CaseAssistant | None = Depends(get_case_assistant),
) -> Translation:
    """A reply typed in English, translated into the case's language (or
    `language`). English in, English out. 503 when AI isn't configured."""
    return await case_assist.translate(service, assistant, case_id, body)


@router.post("/{case_id}/assist/draft-message", response_model=DraftMessage)
async def draft_message(
    case_id: UUID,
    body: DraftMessageRequest | None = None,
    _: StaffMember = Depends(get_current_worker),
    service: CaseService = Depends(get_case_service),
    assistant: CaseAssistant | None = Depends(get_case_assistant),
) -> DraftMessage:
    """A draft update to the requester, for the worker to edit and send (as a
    public update). Never sent by itself. 503 when AI isn't configured."""
    return await case_assist.draft_message(service, assistant, case_id, body)
