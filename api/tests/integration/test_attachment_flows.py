"""Case attachments and knowledge search, against real PostgreSQL with the
object store in memory: upload by signed URL, checked, listed and linked;
search finds resources, resolved cases, their notes and attachment notes."""

from uuid import UUID, uuid4

import pytest

from dependencies import get_attachment_service
from main import app
from services.attachment import AttachmentService, attachment_key
from tests.helpers import auth_header
from tests.integration.test_voice_records import MemoryStorage


@pytest.fixture
async def worker(api, admin_conn):
    headers = auth_header(f"auth0|{uuid4().hex}", name="Maria Santos")
    user_id = (await api.get("/v1/me", headers=headers)).json()["id"]
    await admin_conn.execute("UPDATE app.users SET role = 'admin' WHERE id = $1", user_id)
    return headers


@pytest.fixture
def storage(api):
    memory = MemoryStorage()
    without = app.dependency_overrides[get_attachment_service]()
    app.dependency_overrides[get_attachment_service] = lambda: AttachmentService(
        without.attachments, without.cases, memory
    )
    yield memory
    app.dependency_overrides[get_attachment_service] = lambda: without


async def _case(api, worker, **body):
    payload = {"title": "Needs help", "category": "other"} | body
    return (await api.post("/v1/cases", headers=worker, json=payload)).json()


async def test_a_photo_is_uploaded_checked_listed_and_linked(api, worker, storage):
    case = await _case(api, worker)
    started = await api.post(f"/v1/cases/{case['id']}/attachments", headers=worker, json={
        "file_name": "eviction.jpg", "content_type": "image/jpeg", "size_bytes": 2048,
        "note": "Eviction notice dated Nov 18"})
    assert started.status_code == 201, started.text
    upload = started.json()
    attachment_id = upload["attachment"]["id"]
    assert upload["content_type"] == "image/jpeg" and upload["attachment"]["status"] == "pending"

    # Not uploaded yet: refused, and not listed.
    early = await api.post(f"/v1/cases/{case['id']}/attachments/{attachment_id}/uploaded", headers=worker)
    assert early.status_code == 409
    assert (await api.get(f"/v1/cases/{case['id']}/attachments", headers=worker)).json() == []

    storage.upload(attachment_key(UUID(case["id"]), UUID(attachment_id)), b"x" * 1500)
    done = await api.post(f"/v1/cases/{case['id']}/attachments/{attachment_id}/uploaded", headers=worker)
    assert done.status_code == 200 and done.json()["status"] == "ready" and done.json()["size_bytes"] == 1500

    listed = (await api.get(f"/v1/cases/{case['id']}/attachments", headers=worker)).json()
    assert [a["file_name"] for a in listed] == ["eviction.jpg"]
    link = (await api.get(f"/v1/cases/{case['id']}/attachments/{attachment_id}/link", headers=worker)).json()
    assert link["url"].startswith("https://storage.test/attachments/") and link["expires_in_seconds"] == 300

    detail = (await api.get(f"/v1/cases/{case['id']}", headers=worker)).json()
    assert any(u["content"] == "Attached eviction.jpg: Eviction notice dated Nov 18" for u in detail["updates"])

    gone = await api.delete(f"/v1/cases/{case['id']}/attachments/{attachment_id}", headers=worker)
    assert gone.status_code == 204 and storage.objects == {}


async def test_only_photos_and_pdfs_up_to_10_mb(api, worker, storage):
    case = await _case(api, worker)
    exe = await api.post(f"/v1/cases/{case['id']}/attachments", headers=worker,
                         json={"file_name": "a.exe", "content_type": "application/x-msdownload", "size_bytes": 10})
    assert exe.status_code == 415
    too_big = {"file_name": "a.pdf", "content_type": "application/pdf", "size_bytes": 11 * 1024 * 1024}
    huge = await api.post(f"/v1/cases/{case['id']}/attachments", headers=worker, json=too_big)
    assert huge.status_code == 422


async def test_without_storage_attachments_are_off(api, worker):
    case = await _case(api, worker)
    off = await api.post(f"/v1/cases/{case['id']}/attachments", headers=worker,
                         json={"file_name": "a.pdf", "content_type": "application/pdf", "size_bytes": 10})
    assert off.status_code == 503


async def test_knowledge_search_finds_what_the_team_knows(api, worker, admin_conn):
    tag = f"zq{uuid4().hex[:6]}"
    await api.post("/v1/resources", headers=worker, json={
        "name": f"Funeral fund {tag}", "category": "burial_assistance", "description": f"Grants for burial {tag}."})
    solved = await _case(api, worker, title=f"Burial costs {tag}", description=f"Family needed help {tag}.")
    await api.post(f"/v1/cases/{solved['id']}/updates", headers=worker,
                   json={"content": f"Called the county {tag} fund, approved in two days.", "visibility": "internal"})
    await api.patch(f"/v1/cases/{solved['id']}", headers=worker, json={"status": "resolved"})
    open_case = await _case(api, worker, title=f"Still open {tag}")

    hits = (await api.get("/v1/knowledge/search", headers=worker, params={"q": tag})).json()
    kinds = {h["kind"] for h in hits}
    assert {"resource", "case", "note"} <= kinds
    assert all(h["case_id"] != open_case["id"] for h in hits)  # open cases aren't "knowledge" yet
    assert any("«" in h["snippet"] for h in hits)
    assert (await api.get("/v1/knowledge/search", headers=worker, params={"q": "x"})).json() == []
