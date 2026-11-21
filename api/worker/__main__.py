"""The background worker: `python -m worker` (same image as the API, its own
k8s Deployment). It runs Phantom's pipeline stages from the job queue, and
the queue's upkeep. See worker/runner.py for how a job is handled.

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

from openai import AsyncOpenAI

from adapters.storage import make_audio_storage
from databridge.executor import PostgresExecutor
from databridge.job import JobDatabridge
from databridge.record import RecordDatabridge
from engine.postgres_engine import PostgresDBEngine
from logging_setup import configure_logging
from services.extraction import RecordExtractor
from services.pipeline import AudioSweeper, ExtractStage, RedactStage, Stage, TranscribeStage
from services.redaction import PatternRedactor
from services.transcription import Transcriber
from settings import config
from worker.runner import Runner

logger = logging.getLogger("worker")

UPKEEP_EVERY_SECONDS = 60
PRUNE_EVERY_SECONDS = 3600


async def upkeep(
    records: RecordDatabridge, jobs: JobDatabridge, sweeper: AudioSweeper | None, stop: asyncio.Event
) -> None:
    """Fail records whose job died without telling them, delete audio that
    should be gone, and prune old jobs. Safe on every replica at once (each
    step is idempotent)."""
    last_prune = 0.0
    while not stop.is_set():
        try:
            stalled = await records.fail_stalled(config.worker.stalled_record_seconds)
            if stalled:
                logger.warning("Marked %d stalled record(s) failed", len(stalled))
            if sweeper is not None:
                swept = await sweeper.sweep()
                if swept:
                    logger.info("Deleted %d leftover audio file(s)", swept)
            if time.monotonic() - last_prune > PRUNE_EVERY_SECONDS:
                pruned = await jobs.prune(config.worker.keep_jobs_days)
                last_prune = time.monotonic()
                if pruned:
                    logger.info("Pruned %d finished job(s)", pruned)
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
    if not config.openai.api_key:
        raise SystemExit("APP__OPENAI__API_KEY is not set; the worker needs it for extraction")

    executor = PostgresExecutor(PostgresDBEngine())
    jobs = JobDatabridge(executor)
    records = RecordDatabridge(executor)
    # Below the transcribe stage's timeout; the queue does the retrying.
    openai = AsyncOpenAI(api_key=config.openai.api_key, timeout=100.0, max_retries=0)
    stages: list[Stage] = [
        RedactStage(records, jobs, PatternRedactor()),
        ExtractStage(records, jobs, RecordExtractor(openai.responses, config.openai.model)),
    ]
    sweeper: AudioSweeper | None = None
    storage = make_audio_storage(config.storage)
    if storage is not None:
        if config.storage.create_bucket:
            await storage.ensure_bucket()
        transcriber = Transcriber(openai.audio, config.openai.transcription_model)
        stages.insert(0, TranscribeStage(records, jobs, storage, transcriber))
        sweeper = AudioSweeper(records, storage, config.storage.max_audio_age_seconds)
    else:
        logger.warning("Object storage isn't configured (APP__STORAGE__*): voice debriefs are off")
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

    health = await serve_health(runner, config.worker.health_port)
    try:
        await asyncio.gather(runner.run(stop), upkeep(records, jobs, sweeper, stop))
    finally:
        health.close()
        await executor.dispose()
        logger.info("Worker %s stopped", worker_id)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
