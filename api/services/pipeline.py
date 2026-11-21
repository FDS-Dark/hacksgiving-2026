"""Phantom's pipeline: the stages a record goes through, each one a job kind
in the queue (app.jobs), run by the worker process (worker/).

    voice:  (upload)  ->  record.transcribe  ->  record.redact  ->  record.extract  ->  ready for review
    typed:                                     record.redact  ->  record.extract  ->  ready for review

Every stage follows the same contract, so the queue can retry it safely:
- `run` does the slow part (an AI call) outside any transaction, and only
  reads. It returns `finish`.
- `finish` runs inside one transaction with the job's completion: it saves
  the stage's result, moves the record on, and queues the next stage. If
  the worker lost the job's lease meanwhile, all of it rolls back.
- A job for a record that moved on, was discarded or is gone does nothing,
  so a duplicate or late job is harmless (idempotent).
- `after` runs once the transaction has committed (transcribe deletes the
  audio there). If it fails, the sweeper below cleans up.
- `on_dead` runs once a job has used up its attempts: the record is marked
  failed so the author sees it and can retry.

Audio is never kept: it's deleted after transcription, when a transcribe
job finds nothing left to do, when its job dies, when the record is
discarded, and by the sweeper (which lists the bucket itself, so it also
finds audio no record points to).
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID

from adapters.storage import AudioStorage
from databridge.executor import FunctionCaller
from databridge.job import JobDatabridge
from databridge.record import RecordDatabridge
from models.job import Job
from models.record import Extraction, RecordStage, RecordStatus, StoredRecord
from services.extraction import RecordExtractor
from services.redaction import Redactor
from services.transcription import Transcriber

logger = logging.getLogger(__name__)

TRANSCRIBE = "record.transcribe"
REDACT = "record.redact"
EXTRACT = "record.extract"

STAGE_JOBS: dict[RecordStage, str] = {
    RecordStage.TRANSCRIBE: TRANSCRIBE,
    RecordStage.REDACT: REDACT,
    RecordStage.EXTRACT: EXTRACT,
}

AUDIO_PREFIX = "records/"
AUDIO_CONTENT_TYPE = "audio/mp4"  # .m4a (AAC), what the app records on iOS and Android


def audio_key(record_id: UUID) -> str:
    """Where a record's audio lives: its id only, nothing about the person."""
    return f"{AUDIO_PREFIX}{record_id}.m4a"


FAILED_MESSAGE = "Couldn't finish processing this record. Try again."

Finish = Callable[[FunctionCaller], Awaitable[None]]


async def _nothing(_: FunctionCaller) -> None:
    return None


async def enqueue_stage(jobs: JobDatabridge, record_id: UUID, stage: RecordStage) -> None:
    """Queue the job for `stage`. Twice for the same record and stage is one job."""
    await jobs.enqueue(STAGE_JOBS[stage], {"record_id": str(record_id)}, dedupe_key=f"record:{record_id}:{stage.value}")


class Stage(Protocol):
    kind: str
    # Seconds `run` may take; the queue's lease must be longer.
    timeout: float

    async def run(self, job: Job) -> Finish: ...

    async def after(self, job: Job) -> None: ...

    async def on_dead(self, job: Job) -> None: ...


class _RecordStage:
    stage: RecordStage

    def __init__(self, records: RecordDatabridge, jobs: JobDatabridge) -> None:
        self.records = records
        self.jobs = jobs

    async def _current(self, job: Job) -> StoredRecord | None:
        """The record, if this job is still its next step."""
        record = await self.records.get(UUID(str(job.payload["record_id"])))
        if record is None or record.status != RecordStatus.PROCESSING or record.stage != self.stage:
            return None
        return record

    def _advance(
        self,
        record_id: UUID,
        next_stage: RecordStage,
        *,
        raw_text: str | None = None,
        redacted_text: str | None = None,
        extraction: Extraction | None = None,
    ) -> Finish:
        async def finish(tx: FunctionCaller) -> None:
            advanced = await self.records.within(tx).advance(
                record_id, next_stage, raw_text=raw_text, redacted_text=redacted_text, extraction=extraction
            )
            if advanced is not None and next_stage in STAGE_JOBS:
                await enqueue_stage(self.jobs.within(tx), record_id, next_stage)

        return finish

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        await self.records.fail(UUID(str(job.payload["record_id"])), FAILED_MESSAGE)


class TranscribeStage(_RecordStage):
    kind = TRANSCRIBE
    stage = RecordStage.TRANSCRIBE
    # Download plus transcription of up to ~24 MB of audio.
    timeout = 110.0

    def __init__(
        self, records: RecordDatabridge, jobs: JobDatabridge, storage: AudioStorage, transcriber: Transcriber
    ) -> None:
        super().__init__(records, jobs)
        self.storage = storage
        self.transcriber = transcriber

    async def run(self, job: Job) -> Finish:
        record = await self._current(job)
        if record is None:
            return _nothing  # `after` still deletes any audio left for it
        key = audio_key(record.id)
        text = await self.transcriber.transcribe(await self.storage.read(key), key.rsplit("/", 1)[-1])
        return self._advance(record.id, RecordStage.REDACT, raw_text=text)

    async def after(self, job: Job) -> None:
        # The transcript is saved (or there was nothing to do): the audio goes.
        await self.storage.delete(audio_key(UUID(str(job.payload["record_id"]))))

    async def on_dead(self, job: Job) -> None:
        await super().on_dead(job)
        await self.storage.delete(audio_key(UUID(str(job.payload["record_id"]))))


class AudioSweeper:
    """Deletes audio that should no longer exist. Lists the bucket (not the
    records table) so it also finds uploads no record points to. Keeps only
    audio younger than `max_age_seconds` whose record is still waiting for
    upload or transcription."""

    def __init__(self, records: RecordDatabridge, storage: AudioStorage, max_age_seconds: int) -> None:
        self.records = records
        self.storage = storage
        self.max_age_seconds = max_age_seconds

    async def sweep(self) -> int:
        deleted = 0
        now = datetime.now(timezone.utc)
        for item in await self.storage.list(AUDIO_PREFIX):
            if (now - item.last_modified).total_seconds() < self.max_age_seconds and await self._still_needed(item.key):
                continue
            await self.storage.delete(item.key)
            deleted += 1
        return deleted

    async def _still_needed(self, key: str) -> bool:
        try:
            record_id = UUID(key.removeprefix(AUDIO_PREFIX).removesuffix(".m4a"))
        except ValueError:
            return False
        record = await self.records.get(record_id)
        return (
            record is not None
            and record.status == RecordStatus.PROCESSING
            and record.stage in (RecordStage.UPLOAD, RecordStage.TRANSCRIBE)
        )


class RedactStage(_RecordStage):
    kind = REDACT
    stage = RecordStage.REDACT
    timeout = 30.0

    def __init__(self, records: RecordDatabridge, jobs: JobDatabridge, redactor: Redactor) -> None:
        super().__init__(records, jobs)
        self.redactor = redactor

    async def run(self, job: Job) -> Finish:
        record = await self._current(job)
        if record is None:
            return _nothing
        return self._advance(record.id, RecordStage.EXTRACT, redacted_text=self.redactor.redact(record.raw_text or ""))


class ExtractStage(_RecordStage):
    kind = EXTRACT
    stage = RecordStage.EXTRACT
    timeout = 90.0

    def __init__(self, records: RecordDatabridge, jobs: JobDatabridge, extractor: RecordExtractor) -> None:
        super().__init__(records, jobs)
        self.extractor = extractor

    async def run(self, job: Job) -> Finish:
        record = await self._current(job)
        if record is None:
            return _nothing
        extraction = await self.extractor.extract(record.redacted_text or "")
        return self._advance(record.id, RecordStage.DONE, extraction=extraction)
