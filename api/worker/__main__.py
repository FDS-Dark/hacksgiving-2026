"""The background worker: `python -m worker` (same image as the API, its own
k8s Deployment). It runs jobs from the queue: task reminders and urgent
escalation always, and Phantom's pipeline stages when APP__OPENAI__API_KEY
is set; plus the queue's upkeep. See worker/runner.py for how a job is handled.

Its wiring is its own, not dependencies.py: there's no request, no user,
and it must not build the FastAPI app.
"""

import asyncio
import logging
import os
import signal
import socket
import time
import uuid
from zoneinfo import ZoneInfo

from openai import AsyncOpenAI

from adapters.geocoder import MilwaukeeGeocoder
from adapters.push import PushProvider, make_push_provider
from adapters.sms import make_sms_sender
from adapters.storage import AudioStorage, make_audio_storage
from databridge.executor import PostgresExecutor
from databridge.job import JobDatabridge
from databridge.notification import NotificationDatabridge
from databridge.oncall import OncallDatabridge
from databridge.partner import PartnerDatabridge
from databridge.place import PlaceDatabridge
from databridge.public_data import PublicDataDatabridge
from databridge.push import PushDatabridge
from databridge.request_push import RequestPushDatabridge
from databridge.record import RecordDatabridge
from databridge.staff import StaffDatabridge
from databridge.task import TaskDatabridge
from databridge.text import TextDatabridge
from engine.postgres_engine import PostgresDBEngine
from logging_setup import configure_logging
from services.extraction import RecordExtractor
from services.notification import NotificationService
from services.notification_jobs import TaskRemindStage
from services.oncall import OncallService
from services.oncall_jobs import EscalateStage, OfferStage, RemindStage
from services.push_jobs import PushStage
from services.place import CasePlacer
from services.pipeline import AudioSweeper, ExtractStage, RedactStage, Stage, TranscribeStage
from services.redaction import PatternRedactor
from services.staff import StaffService
from services.task import TaskService
from services.partner import PartnerTexter
from services.text import CaseTexter
from services.request_push import RequestPushStage
from services.transcription import Transcriber
from services.weather_jobs import WeatherWatch
from settings import config
from worker.runner import Runner

logger = logging.getLogger("worker")

UPKEEP_EVERY_SECONDS = 60
PRUNE_EVERY_SECONDS = 3600


def build_stages(
    executor: PostgresExecutor,
    openai_api_key: str | None,
    storage: AudioStorage | None,
    push: PushProvider | None = None,
) -> tuple[list[Stage], AudioSweeper | None]:
    """The stages this worker runs, and the audio sweeper (None without
    voice). Task reminders and push always run (push without a provider
    finishes its jobs without sending); Phantom's stages need the OpenAI
    key, and transcription also needs object storage."""
    jobs, records = JobDatabridge(executor), RecordDatabridge(executor)
    notifications = NotificationService(NotificationDatabridge(executor), executor)
    alerts, oncall = OncallDatabridge(executor), config.oncall
    stages: list[Stage] = [
        TaskRemindStage(TaskDatabridge(executor), notifications),
        OfferStage(alerts, jobs, notifications, oncall.offer_seconds),
        EscalateStage(alerts, jobs),
        RemindStage(alerts, jobs, notifications, oncall.remind_seconds, oncall.max_reminders),
    ]
    stages.append(PushStage(PushDatabridge(executor), jobs, push, ZoneInfo(oncall.timezone)))
    stages.append(RequestPushStage(RequestPushDatabridge(executor), push))
    if not openai_api_key:
        logger.warning("APP__OPENAI__API_KEY is not set: Phantom's stages are off (debriefs stay 'processing')")
        return stages, None
    # Below the transcribe stage's timeout; the queue does the retrying.
    openai = AsyncOpenAI(api_key=openai_api_key, timeout=100.0, max_retries=0)
    stages += [
        RedactStage(records, jobs, PatternRedactor()),
        ExtractStage(records, jobs, RecordExtractor(openai.responses, config.openai.model)),
    ]
    if storage is None:
        logger.warning("Object storage isn't configured (APP__STORAGE__*): voice debriefs are off")
        return stages, None
    transcriber = Transcriber(openai.audio, config.openai.transcription_model)
    stages.append(TranscribeStage(records, jobs, storage, transcriber))
    return stages, AudioSweeper(records, storage, config.storage.max_audio_age_seconds)


def build_oncall(executor: PostgresExecutor) -> OncallService:
    """For the upkeep's alert sweeper."""
    jobs, notifications = JobDatabridge(executor), NotificationService(NotificationDatabridge(executor), executor)
    tasks = TaskService(TaskDatabridge(executor), StaffService(StaffDatabridge(executor)), jobs, executor)
    return OncallService(
        OncallDatabridge(executor), executor, ZoneInfo(config.oncall.timezone),
        jobs=jobs, notifications=notifications, tasks=tasks,
    )


async def upkeep(
    records: RecordDatabridge,
    jobs: JobDatabridge,
    notifications: NotificationDatabridge,
    sweeper: AudioSweeper | None,
    stop: asyncio.Event,
    oncall: OncallService | None = None,
    push: PushDatabridge | None = None,
    weather: WeatherWatch | None = None,
    placer: CasePlacer | None = None,
    texter: CaseTexter | None = None,
    partner_texter: PartnerTexter | None = None,
) -> None:
    """Fail records whose job died without telling them, open on-call alerts
    a code path missed, place new cases for Insights, text requesters
    about updates and partners about requests for help, delete audio that should be gone, and prune old jobs
    and notifications. Safe on every replica at once (each step is
    idempotent)."""
    last_prune = 0.0
    while not stop.is_set():
        try:
            stalled = await records.fail_stalled(config.worker.stalled_record_seconds)
            if stalled:
                logger.warning("Marked %d stalled record(s) failed", len(stalled))
            if oncall is not None:
                await oncall.sweep()
            if weather is not None:
                await weather.sweep()
            if placer is not None:
                await placer.sweep()
            if texter is not None:
                await texter.sweep()
            if partner_texter is not None:
                await partner_texter.sweep()
            if sweeper is not None:
                swept = await sweeper.sweep()
                if swept:
                    logger.info("Deleted %d leftover audio file(s)", swept)
            if time.monotonic() - last_prune > PRUNE_EVERY_SECONDS:
                pruned = await jobs.prune(config.worker.keep_jobs_days)
                old = await notifications.prune(config.worker.keep_notifications_days)
                if push is not None:
                    devices = await push.prune_devices(config.worker.keep_push_devices_days)
                    deliveries = await push.prune_deliveries(config.worker.keep_push_deliveries_days)
                    if devices or deliveries:
                        logger.info("Pruned %d unseen push device(s) and %d old delivery(ies)", devices, deliveries)
                last_prune = time.monotonic()
                if pruned or old:
                    logger.info("Pruned %d finished job(s) and %d old notification(s)", pruned, old)
        except Exception:
            logger.exception("Upkeep failed; trying again next round")
        try:
            await asyncio.wait_for(stop.wait(), timeout=UPKEEP_EVERY_SECONDS)
        except TimeoutError:
            pass


async def serve_health(runner: Runner, port: int) -> asyncio.base_events.Server:
    """`GET /` answers 200 while the poll loop is turning, 503 once it has
    been stuck for two minutes (the liveness probe then restarts the pod)."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await asyncio.wait_for(reader.readline(), timeout=2)
            healthy = time.monotonic() - runner.last_tick < 120
            status = "200 OK" if healthy else "503 Service Unavailable"
            body = b"ok\n" if healthy else b"stalled\n"
            head = f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n"
            writer.write(head.encode() + body)
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    return await asyncio.start_server(handle, "0.0.0.0", port)


async def main() -> None:
    configure_logging(config.logging)
    executor = PostgresExecutor(PostgresDBEngine())
    jobs = JobDatabridge(executor)
    records = RecordDatabridge(executor)
    storage = make_audio_storage(config.storage) if config.openai.api_key else None
    if storage is not None and config.storage.create_bucket:
        await storage.ensure_bucket()
    push = make_push_provider(config.push)
    stages, sweeper = build_stages(executor, config.openai.api_key, storage, push)
    # Unique per process, readable in the jobs table: which pod holds a job.
    worker_id = f"{os.environ.get('HOSTNAME') or socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
    runner = Runner(
        jobs,
        executor,
        stages,
        worker_id=worker_id,
        concurrency=config.worker.concurrency,
        lease_seconds=config.worker.lease_seconds,
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows: Ctrl+C still raises KeyboardInterrupt
            pass

    geocoder = MilwaukeeGeocoder() if config.worker.place_cases and config.worker.geocode_cases else None
    placer = (
        CasePlacer(PlaceDatabridge(executor), PublicDataDatabridge(executor), geocoder)
        if config.worker.place_cases else None
    )

    sms = make_sms_sender(config.sms)
    texter = CaseTexter(TextDatabridge(executor), sms, coalesce_minutes=config.sms.coalesce_minutes) if sms else None
    partner_texter = PartnerTexter(PartnerDatabridge(executor), sms) if sms else None

    health = await serve_health(runner, config.worker.health_port)
    try:
        await asyncio.gather(
            runner.run(stop),
            upkeep(
                records, jobs, NotificationDatabridge(executor), sweeper, stop, build_oncall(executor),
                PushDatabridge(executor),
                WeatherWatch(executor, NotificationService(NotificationDatabridge(executor), executor)),
                placer, texter, partner_texter,
            ),
        )
    finally:
        health.close()
        if geocoder is not None:
            await geocoder.close()
        if sms is not None:
            await sms.close()
        if push is not None:
            await push.close()
        await executor.dispose()
        logger.info("Worker %s stopped", worker_id)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
