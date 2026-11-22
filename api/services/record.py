"""Phantom records for staff: capture a debrief, follow it through the
pipeline (services/pipeline.py, run by the worker), review what the AI
made of it, and confirm it into a case with tasks.

Records are private to their author (and admins): a debrief can name
people in a domestic-violence situation before it becomes a case."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from adapters.storage import AudioStorage
from databridge.executor import Transactions
from databridge.job import JobDatabridge
from databridge.record import RecordDatabridge
from errors import ApiError, not_found
from models.case import AddCaseUpdateRequest, CreateCaseRequest, UpdateCaseRequest, Visibility
from models.case_enums import CasePriority
from models.record import (
    ConfirmedRecord,
    ConfirmRecordRequest,
    CreateRecordRequest,
    Record,
    RecordSource,
    RecordStage,
    RecordStatus,
    StoredRecord,
    VoiceUpload,
)
from models.staff import Role, StaffMember
from models.task import CreateTaskRequest
from services.case import CaseService
from services.redaction import find_phone
from services.pipeline import AUDIO_CONTENT_TYPE, audio_key, enqueue_stage
from services.task import TaskService

logger = logging.getLogger(__name__)

PRIORITY_RANK = {CasePriority.LOW: 0, CasePriority.MEDIUM: 1, CasePriority.HIGH: 2, CasePriority.CRITICAL: 3}


def public(record: StoredRecord) -> Record:
    """The record without the redacted text (pipeline-internal), plus the
    callback number found in what the author wrote."""
    return Record(
        **record.model_dump(exclude={"redacted_text", "callback_phone"}),
        callback_phone=find_phone(record.raw_text),
    )


class RecordService:
    def __init__(
        self,
        records: RecordDatabridge,
        jobs: JobDatabridge,
        transactions: Transactions,
        cases: CaseService,
        tasks: TaskService,
        storage: AudioStorage | None = None,
        *,
        max_audio_bytes: int = 24 * 1024 * 1024,
        upload_url_seconds: int = 540,
    ) -> None:
        self.records = records
        self.jobs = jobs
        self.transactions = transactions
        self.cases = cases
        self.tasks = tasks
        # None when object storage isn't configured: voice is off, typed works.
        self.storage = storage
        self.max_audio_bytes = max_audio_bytes
        self.upload_url_seconds = upload_url_seconds

    async def create(self, worker: StaffMember, body: CreateRecordRequest) -> Record:
        if body.case_id is not None:
            await self.cases.get(body.case_id)  # 404 for a case that doesn't exist
        # The record and its first job in one transaction: a record is never
        # left without the job that processes it, or the other way round.
        async with self.transactions.transaction() as tx:
            records = self.records.within(tx)
            record = await records.create(worker.id, RecordSource.TEXT, body.text, RecordStage.REDACT)
            if body.case_id is not None:
                record = await records.set_case(record.id, body.case_id) or record
            await enqueue_stage(self.jobs.within(tx), record.id, RecordStage.REDACT)
        logger.info("Record %s created by worker %s", record.id, worker.id)
        return public(record)

    async def start_voice(self, worker: StaffMember, case_id: UUID | None = None) -> VoiceUpload:
        """A voice record waiting for its audio, and a one-time URL to upload
        it to. Nothing is queued until the app says the upload finished; a
        record whose audio never arrives is failed by the worker's upkeep."""
        storage = self._storage()
        if case_id is not None:
            await self.cases.get(case_id)
        async with self.transactions.transaction() as tx:
            records = self.records.within(tx)
            record = await records.create(worker.id, RecordSource.AUDIO, None, RecordStage.UPLOAD)
            if case_id is not None:
                record = await records.set_case(record.id, case_id) or record
        return VoiceUpload(
            record=public(record),
            upload_url=await storage.upload_url(audio_key(record.id), AUDIO_CONTENT_TYPE),
            content_type=AUDIO_CONTENT_TYPE,
            max_bytes=self.max_audio_bytes,
            expires_in_seconds=self.upload_url_seconds,
        )

    async def audio_uploaded(self, worker: StaffMember, record_id: UUID) -> Record:
        """The app finished uploading: check the audio is there and not too
        big, then queue transcription (with the record's move, in one
        transaction). A repeat call is harmless."""
        storage = self._storage()
        record = await self._own(worker, record_id)
        if record.status != RecordStatus.PROCESSING or record.stage != RecordStage.UPLOAD:
            return public(record)
        audio = await storage.head(audio_key(record_id))
        if audio is None:
            raise ApiError(409, "audio_not_uploaded", "The recording hasn't arrived yet; upload it, then try again")
        if audio.size > self.max_audio_bytes:
            await storage.delete(audio_key(record_id))
            await self.records.fail(record_id, "The recording was too long. Keep debriefs under about ten minutes.")
            raise ApiError(413, "audio_too_large", "The recording is too long")
        async with self.transactions.transaction() as tx:
            moved = await self.records.within(tx).advance(record_id, RecordStage.TRANSCRIBE)
            if moved is not None:
                await enqueue_stage(self.jobs.within(tx), record_id, RecordStage.TRANSCRIBE)
        return public(moved or record)

    async def mine(self, worker: StaffMember, limit: int = 50) -> list[Record]:
        return [public(r) for r in await self.records.list_by_author(worker.id, limit)]

    async def get(self, worker: StaffMember, record_id: UUID) -> Record:
        return public(await self._own(worker, record_id))

    async def retry(self, worker: StaffMember, record_id: UUID) -> Record:
        await self._own(worker, record_id)
        async with self.transactions.transaction() as tx:
            record = await self.records.within(tx).retry(record_id)
            if record is None:
                raise ApiError(409, "record_not_failed", "Only a record that failed can be tried again")
            await enqueue_stage(self.jobs.within(tx), record.id, record.stage)
        return public(record)

    async def discard(self, worker: StaffMember, record_id: UUID) -> Record:
        await self._own(worker, record_id)
        record = await self.records.discard(record_id)
        if record is None:
            raise ApiError(409, "record_busy", "This record is being saved right now; try again in a moment")
        if self.storage is not None and record.source == RecordSource.AUDIO:
            try:
                await self.storage.delete(audio_key(record_id))
            except Exception:
                # The sweeper deletes it within minutes (its record is discarded).
                logger.warning("Couldn't delete the audio of discarded record %s yet", record_id)
        return public(record)

    async def confirm(self, worker: StaffMember, record_id: UUID, body: ConfirmRecordRequest) -> ConfirmedRecord:
        """Turn the reviewed record into a case. Safe to call twice: only one
        call can move the record from ready to confirming, and a repeat after
        it's confirmed returns the same case."""
        current = await self._own(worker, record_id)
        record = await self.records.begin_confirm(record_id)
        if record is None:
            if current.status == RecordStatus.CONFIRMED and current.case_id is not None:
                return ConfirmedRecord(record=public(current), case=await self.cases.get(current.case_id))
            if current.status == RecordStatus.CONFIRMING:
                raise ApiError(409, "record_busy", "This record is being saved right now")
            raise ApiError(409, "record_not_ready", "This record isn't ready to confirm yet")

        if record.case_id is not None:
            return await self._confirm_into(worker, record, body)

        # The callback number the author gave is redacted before the AI reads
        # the debrief, so it isn't in the extraction. The app offers it on the
        # review screen; a client that leaves the field out entirely still
        # gets it from what the author wrote. (An explicit null means the
        # author removed it.) The number goes only on the case contact and its
        # call task, never into the title, summary or task titles: those reach
        # the AI assistant and push notifications.
        phone = body.contact_phone if "contact_phone" in body.model_fields_set else find_phone(record.raw_text)

        try:
            case = await self.cases.create(
                worker,
                CreateCaseRequest(
                    title=body.title,
                    description=body.summary,
                    kind=body.kind,
                    category=body.category,
                    priority=body.priority,
                    location=body.location,
                    contact_name=body.contact_name,
                    contact_phone=phone,
                    assigned_worker_id=worker.id,
                ),
            )
            now = datetime.now(timezone.utc)
            for task in body.tasks:
                due = now + timedelta(hours=task.due_in_hours) if task.due_in_hours else None
                await self.tasks.add(worker, case.id, CreateTaskRequest(title=task.title, due_at=due))
            await self.cases.add_update(
                worker,
                case.id,
                AddCaseUpdateRequest(content="Opened from a recorded debrief.", visibility=Visibility.INTERNAL),
            )
        except Exception:
            await self.records.abort_confirm(record_id)
            raise

        confirmed = await self.records.finish_confirm(record_id, case.id)
        if confirmed is None:  # pragma: no cover - only this call holds the record in confirming
            raise ApiError(409, "record_busy", "This record changed while it was being saved")
        logger.info("Record %s confirmed into case #%s", record_id, case.number)
        return ConfirmedRecord(record=public(confirmed), case=case)

    async def _confirm_into(
        self, worker: StaffMember, record: StoredRecord, body: ConfirmRecordRequest
    ) -> ConfirmedRecord:
        """A debrief about an existing case (taken from the Responding
        screen): its summary goes on the case as an internal note, its tasks
        are added, and the priority goes up if the debrief calls for more.
        Nothing about the case is lowered or overwritten."""
        assert record.case_id is not None
        case_id = record.case_id
        try:
            case = await self.cases.get(case_id)
            changes = UpdateCaseRequest()
            if PRIORITY_RANK[body.priority] > PRIORITY_RANK[case.priority]:
                changes.priority = body.priority
            if body.location and not case.location:
                changes.location = body.location
            if changes.model_fields_set:
                await self.cases.update(worker, case_id, changes)
            note = f"Debrief: {body.title}" + (f"\n\n{body.summary}" if body.summary else "")
            await self.cases.add_update(
                worker, case_id, AddCaseUpdateRequest(content=note[:4000], visibility=Visibility.INTERNAL)
            )
            now = datetime.now(timezone.utc)
            for task in body.tasks:
                due = now + timedelta(hours=task.due_in_hours) if task.due_in_hours else None
                await self.tasks.add(worker, case_id, CreateTaskRequest(title=task.title, due_at=due))
            case = await self.cases.get(case_id)
        except Exception:
            await self.records.abort_confirm(record.id)
            raise

        confirmed = await self.records.finish_confirm(record.id, case_id)
        if confirmed is None:  # pragma: no cover - only this call holds the record in confirming
            raise ApiError(409, "record_busy", "This record changed while it was being saved")
        logger.info("Record %s added to case #%s", record.id, case.number)
        return ConfirmedRecord(record=public(confirmed), case=case, updated_existing=True)

    def _storage(self) -> AudioStorage:
        if self.storage is None:
            raise ApiError(503, "voice_unavailable", "Voice debriefs aren't set up on this server; type it instead")
        return self.storage

    async def _own(self, worker: StaffMember, record_id: UUID) -> StoredRecord:
        """The record, if this worker wrote it (or is an admin). Anyone else
        gets 404: a debrief's existence is private too."""
        record = await self.records.get(record_id)
        if record is None or (record.author_id != worker.id and worker.role != Role.ADMIN):
            raise not_found("record")
        return record
