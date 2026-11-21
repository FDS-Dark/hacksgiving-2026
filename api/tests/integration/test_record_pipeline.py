"""Phantom end to end against real PostgreSQL: a worker types a debrief, the
background worker redacts and extracts it (a fake AI here), the author
reviews and confirms it into a case with tasks."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from databridge.job import JobDatabridge
from databridge.record import RecordDatabridge
from models.record import Extraction, ExtractedTask
from services.extraction import ExtractionFailed
from services.pipeline import ExtractStage, RedactStage, Stage
from services.redaction import PatternRedactor
from tests.helpers import auth_header
from tests.integration.conftest import app_executor
from worker.runner import Runner

DEBRIEF = (
    "Met a mom named Keisha Brown at 35th and Center. Evicted today, two kids, "
    "nowhere to sleep tonight. Her phone is 414-555-0182. Needs a shelter bed and a ride."
)


class FakeExtractor:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.seen: list[str] = []

    async def extract(self, redacted_text: str) -> Extraction:
        self.seen.append(redacted_text)
        if self.fail:
            raise ExtractionFailed("The AI service didn't answer (APITimeoutError).")
        return Extraction(
            title="Family evicted, needs a bed tonight",
            summary="A mother and two kids were evicted today and need shelter tonight.",
            kind="request",
            category="homelessness",
            priority="high",
            location="35th and Center",
            risk_flags=["children present"],
            tasks=[ExtractedTask(title="Find a shelter bed", due_in_hours=2)],
        )


@pytest.fixture
async def worker_api(api, admin_conn):
    sub = f"auth0|{uuid4().hex}"
    headers = auth_header(sub, name="Maria Santos")
    worker_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", worker_id)
    return headers


@pytest.fixture
async def pipeline(database):
    """A runner like the worker process's, with a fake AI. `run()` works the
    queue until nothing is left for these stages."""
    executor = app_executor(database)
    jobs, records = JobDatabridge(executor), RecordDatabridge(executor)
    extractor = FakeExtractor()
    stages: list[Stage] = [
        RedactStage(records, jobs, PatternRedactor()),
        ExtractStage(records, jobs, extractor),  # type: ignore[arg-type]
    ]
    runner = Runner(
        jobs,
        executor,
        stages,
        worker_id=f"test-{uuid4().hex[:6]}",
        lease_seconds=120,
    )

    async def run() -> None:
        for _ in range(20):
            if not await runner.tick():
                await runner.drain()
                if not await runner.tick():
                    return
            await runner.drain()

    yield SimpleNamespace(run=run, extractor=extractor, runner=runner, jobs=jobs)
    await executor.dispose()


async def test_a_debrief_becomes_a_case(api, worker_api, pipeline, admin_conn):
    created = await api.post("/v1/records", headers=worker_api, json={"text": DEBRIEF})
    assert created.status_code == 202
    record = created.json()
    assert record["status"] == "processing" and record["stage"] == "redact"

    await pipeline.run()

    # The AI saw no name and no phone number.
    (seen,) = pipeline.extractor.seen
    assert "Keisha" not in seen and "555-0182" not in seen and "35th and Center" in seen

    ready = (await api.get(f"/v1/records/{record['id']}", headers=worker_api)).json()
    assert ready["status"] == "ready" and ready["stage"] == "done"
    assert ready["extraction"]["category"] == "homelessness"
    assert "redacted_text" not in ready

    review = {
        "title": "Family evicted, needs a bed tonight",
        "summary": ready["extraction"]["summary"],
        "category": "homelessness",
        "priority": "high",
        "location": "N 35th St & W Center St",
        "tasks": [{"title": "Find a shelter bed", "due_in_hours": 2}],
    }
    confirmed = await api.post(f"/v1/records/{record['id']}/confirm", headers=worker_api, json=review)
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["record"]["status"] == "confirmed" and body["case"]["priority"] == "high"
    case_id = body["case"]["id"]

    # A double tap returns the same case, never a second one.
    again = await api.post(f"/v1/records/{record['id']}/confirm", headers=worker_api, json=review)
    assert again.json()["case"]["id"] == case_id

    detail = (await api.get(f"/v1/cases/{case_id}", headers=worker_api)).json()
    assert any(t["title"] == "Find a shelter bed" for t in detail["tasks"])
    assert detail["case"]["assigned_worker_id"] is not None

    # No job is left behind for this record.
    live = await admin_conn.fetchval(
        "SELECT count(*) FROM app.jobs WHERE payload->>'record_id' = $1 AND status IN ('queued','running')",
        record["id"],
    )
    assert live == 0


async def test_records_are_private_to_their_author(api, worker_api, admin_conn):
    record = (await api.post("/v1/records", headers=worker_api, json={"text": "Short note."})).json()
    other = auth_header(f"auth0|{uuid4().hex}", name="Another Worker")
    other_id = (await api.get("/v1/me", headers=other)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'worker' WHERE id = $1", other_id)
    assert (await api.get(f"/v1/records/{record['id']}", headers=other)).status_code == 404
    member = auth_header(f"auth0|{uuid4().hex}", name="Casey")
    assert (await api.post("/v1/records", headers=member, json={"text": "hi"})).status_code == 403


async def test_a_record_whose_extraction_keeps_failing_is_marked_failed_and_can_retry(
    api, worker_api, pipeline, admin_conn
):
    pipeline.extractor.fail = True
    record = (await api.post("/v1/records", headers=worker_api, json={"text": DEBRIEF})).json()
    for _ in range(5):  # one attempt per round; retries are made due at once
        await pipeline.run()
        await admin_conn.execute(
            "UPDATE app.jobs SET run_at = now() WHERE payload->>'record_id' = $1 AND status = 'queued'", record["id"]
        )
    failed = (await api.get(f"/v1/records/{record['id']}", headers=worker_api)).json()
    assert failed["status"] == "failed" and failed["stage"] == "extract"
    assert "Keisha" not in (failed["error"] or "")
    last_error = await admin_conn.fetchval(
        "SELECT last_error FROM app.jobs WHERE payload->>'record_id' = $1 AND status = 'dead'", record["id"]
    )
    assert "APITimeoutError" in last_error and "Keisha" not in last_error

    pipeline.extractor.fail = False
    retried = await api.post(f"/v1/records/{record['id']}/retry", headers=worker_api)
    assert retried.status_code == 202
    await pipeline.run()
    assert (await api.get(f"/v1/records/{record['id']}", headers=worker_api)).json()["status"] == "ready"


async def test_discarding_wipes_the_text_and_stops_the_pipeline(api, worker_api, pipeline):
    record = (await api.post("/v1/records", headers=worker_api, json={"text": DEBRIEF})).json()
    discarded = await api.delete(f"/v1/records/{record['id']}", headers=worker_api)
    assert discarded.json()["status"] == "discarded" and discarded.json()["raw_text"] is None
    await pipeline.run()
    assert pipeline.extractor.seen == []
