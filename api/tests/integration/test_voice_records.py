"""Voice debriefs against real PostgreSQL: the app uploads audio to a signed
URL, the worker transcribes it (a fake service here), then the usual
redact and extract. The audio must be gone afterwards, whatever happens."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from adapters.storage import StoredObject
from databridge.job import JobDatabridge
from databridge.record import RecordDatabridge
from dependencies import get_record_service
from main import app
from services.pipeline import AudioSweeper, ExtractStage, RedactStage, Stage, TranscribeStage, audio_key
from services.record import RecordService
from services.redaction import PatternRedactor
from services.transcription import TranscriptionFailed
from tests.helpers import auth_header
from tests.integration.conftest import app_executor
from tests.integration.test_record_pipeline import FakeExtractor
from worker.runner import Runner

SPOKEN = "I met a dad named Marcus Reed on 27th and Wells. He needs food for three kids tonight."


class MemoryStorage:
    """The S3 bucket, in memory. `upload` stands in for the phone's PUT."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, datetime]] = {}

    async def upload_url(self, key: str, content_type: str) -> str:
        return f"https://storage.test/{key}?signed"

    async def ensure_bucket(self) -> None:
        return None

    def upload(self, key: str, data: bytes, age: timedelta = timedelta()) -> None:
        self.objects[key] = (data, datetime.now(timezone.utc) - age)

    async def head(self, key: str) -> StoredObject | None:
        if key not in self.objects:
            return None
        data, when = self.objects[key]
        return StoredObject(key=key, size=len(data), last_modified=when)

    async def read(self, key: str) -> bytes:
        return self.objects[key][0]

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def list(self, prefix: str) -> list[StoredObject]:
        return [StoredObject(k, len(d), w) for k, (d, w) in self.objects.items() if k.startswith(prefix)]


class FakeTranscriber:
    def __init__(self) -> None:
        self.fail = False
        self.heard: list[bytes] = []

    async def transcribe(self, audio: bytes, filename: str) -> str:
        self.heard.append(audio)
        if self.fail:
            raise TranscriptionFailed("The transcription service didn't answer (APITimeoutError).")
        return SPOKEN


@pytest.fixture
async def voice(api, database, admin_conn):
    executor = app_executor(database)
    storage, transcriber, extractor = MemoryStorage(), FakeTranscriber(), FakeExtractor()
    records, jobs = RecordDatabridge(executor), JobDatabridge(executor)
    real = app.dependency_overrides[get_record_service]()
    app.dependency_overrides[get_record_service] = lambda: RecordService(
        records, jobs, executor, real.cases, real.tasks, storage, max_audio_bytes=1000
    )
    stages: list[Stage] = [
        TranscribeStage(records, jobs, storage, transcriber),  # type: ignore[arg-type]
        RedactStage(records, jobs, PatternRedactor()),
        ExtractStage(records, jobs, extractor),  # type: ignore[arg-type]
    ]
    runner = Runner(jobs, executor, stages, worker_id=f"test-{uuid4().hex[:6]}", lease_seconds=150)

    async def run() -> None:
        for _ in range(10):
            claimed = await runner.tick()
            await runner.drain()
            if not claimed:
                return

    headers = auth_header(f"auth0|{uuid4().hex}", name="Devon Harris")
    worker_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    yield SimpleNamespace(
        headers=headers, storage=storage, transcriber=transcriber, extractor=extractor, run=run,
        sweeper=AudioSweeper(records, storage, max_age_seconds=3600),
    )
    await executor.dispose()


async def _start(api, voice) -> dict:
    started = await api.post("/v1/records/voice", headers=voice.headers)
    assert started.status_code == 201, started.text
    body = started.json()
    assert body["record"]["source"] == "audio" and body["record"]["stage"] == "upload"
    assert body["content_type"] == "audio/mp4" and body["upload_url"].startswith("https://storage.test/records/")
    return body


async def test_a_voice_debrief_is_transcribed_and_its_audio_deleted(api, voice):
    body = await _start(api, voice)
    record_id = body["record"]["id"]
    key = audio_key(UUID(record_id))

    early = await api.post(f"/v1/records/{record_id}/uploaded", headers=voice.headers)
    assert early.status_code == 409 and early.json()["code"] == "audio_not_uploaded"

    voice.storage.upload(key, b"m4a-bytes")
    uploaded = await api.post(f"/v1/records/{record_id}/uploaded", headers=voice.headers)
    assert uploaded.status_code == 202 and uploaded.json()["stage"] == "transcribe"
    # Saying so twice queues one job.
    assert (await api.post(f"/v1/records/{record_id}/uploaded", headers=voice.headers)).status_code == 202

    await voice.run()

    assert voice.transcriber.heard == [b"m4a-bytes"]
    assert key not in voice.storage.objects  # deleted right after transcription
    (seen,) = voice.extractor.seen
    assert "Marcus" not in seen and "27th and Wells" in seen  # redacted before the AI read it

    ready = (await api.get(f"/v1/records/{record_id}", headers=voice.headers)).json()
    assert ready["status"] == "ready" and ready["raw_text"] == SPOKEN


async def test_too_long_a_recording_is_refused_and_deleted(api, voice):
    record_id = (await _start(api, voice))["record"]["id"]
    voice.storage.upload(audio_key(UUID(record_id)), b"x" * 2000)
    refused = await api.post(f"/v1/records/{record_id}/uploaded", headers=voice.headers)
    assert refused.status_code == 413
    assert voice.storage.objects == {}
    assert (await api.get(f"/v1/records/{record_id}", headers=voice.headers)).json()["status"] == "failed"


async def test_audio_is_deleted_when_transcription_keeps_failing(api, voice, admin_conn):
    voice.transcriber.fail = True
    record_id = (await _start(api, voice))["record"]["id"]
    key = audio_key(UUID(record_id))
    voice.storage.upload(key, b"m4a-bytes")
    await api.post(f"/v1/records/{record_id}/uploaded", headers=voice.headers)
    for _ in range(5):
        await voice.run()
        await admin_conn.execute(
            "UPDATE app.jobs SET run_at = now() WHERE payload->>'record_id' = $1 AND status = 'queued'", record_id
        )
    failed = (await api.get(f"/v1/records/{record_id}", headers=voice.headers)).json()
    assert failed["status"] == "failed" and failed["stage"] == "transcribe"
    assert key not in voice.storage.objects  # gone once the job died


async def test_discarding_deletes_the_audio(api, voice):
    record_id = (await _start(api, voice))["record"]["id"]
    key = audio_key(UUID(record_id))
    voice.storage.upload(key, b"m4a-bytes")
    await api.delete(f"/v1/records/{record_id}", headers=voice.headers)
    assert key not in voice.storage.objects


async def test_the_sweeper_keeps_only_audio_still_waiting(api, voice):
    waiting = (await _start(api, voice))["record"]["id"]
    voice.storage.upload(audio_key(UUID(waiting)), b"keep")
    voice.storage.upload(audio_key(uuid4()), b"no record")  # an orphan
    voice.storage.upload("records/not-a-record.m4a", b"junk")
    old = (await _start(api, voice))["record"]["id"]
    voice.storage.upload(audio_key(UUID(old)), b"too old", age=timedelta(hours=2))

    assert await voice.sweeper.sweep() == 3
    assert list(voice.storage.objects) == [audio_key(UUID(waiting))]
