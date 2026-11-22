"""Phantom records: a worker's debrief, processed in the background into a
suggested case, reviewed, then confirmed. Staff only; each record is private
to its author (and admins)."""

from uuid import UUID

from fastapi import APIRouter, Depends, status

from dependencies import get_current_worker, get_record_service
from models.record import (
    ConfirmedRecord,
    ConfirmRecordRequest,
    CreateRecordRequest,
    Record,
    StartVoiceRecordRequest,
    VoiceUpload,
)
from models.staff import StaffMember
from services.record import RecordService

router = APIRouter(prefix="/records", tags=["records"])


@router.post("", response_model=Record, status_code=status.HTTP_202_ACCEPTED)
async def create_record(
    body: CreateRecordRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> Record:
    """Capture a typed debrief. 202: it's processed in the background; poll
    `GET /records/{id}` until `status` is `ready` (or `failed`)."""
    return await service.create(worker, body)


@router.post("/voice", response_model=VoiceUpload, status_code=status.HTTP_201_CREATED)
async def start_voice_record(
    body: StartVoiceRecordRequest | None = None,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> VoiceUpload:
    """Start a voice debrief: a record waiting for its audio, and a one-time
    URL to PUT the recording (.m4a) to. Then call `/records/{id}/uploaded`.
    The audio is deleted as soon as it's transcribed. 503 when voice isn't
    set up on the server. Send `case_id` for a debrief about an existing case."""
    return await service.start_voice(worker, body.case_id if body else None)


@router.post("/{record_id}/uploaded", response_model=Record, status_code=status.HTTP_202_ACCEPTED)
async def voice_uploaded(
    record_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> Record:
    """The recording is uploaded: it's transcribed, redacted and read in the
    background. Poll `GET /records/{id}` as for a typed debrief."""
    return await service.audio_uploaded(worker, record_id)


@router.get("", response_model=list[Record])
async def my_records(
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> list[Record]:
    """The caller's records, newest first."""
    return await service.mine(worker)


@router.get("/{record_id}", response_model=Record)
async def get_record(
    record_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> Record:
    return await service.get(worker, record_id)


@router.post("/{record_id}/retry", response_model=Record, status_code=status.HTTP_202_ACCEPTED)
async def retry_record(
    record_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> Record:
    """Process a failed record again, from the stage it stopped at."""
    return await service.retry(worker, record_id)


@router.post("/{record_id}/confirm", response_model=ConfirmedRecord)
async def confirm_record(
    record_id: UUID,
    body: ConfirmRecordRequest,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> ConfirmedRecord:
    """Open a case from the reviewed record (assigned to the caller), with its
    planned tasks plus the ones sent here. A debrief captured for an existing
    case (`case_id` set) is added to that case instead: an internal note, its
    tasks, and a higher priority if it calls for one (`updated_existing`).
    Calling it again returns the same case."""
    return await service.confirm(worker, record_id, body)


@router.delete("/{record_id}", response_model=Record)
async def discard_record(
    record_id: UUID,
    worker: StaffMember = Depends(get_current_worker),
    service: RecordService = Depends(get_record_service),
) -> Record:
    """Throw a record away; its text is deleted. A case it became stays."""
    return await service.discard(worker, record_id)
