"""The Supabase Storage adapter's requests and how it reads the answers,
against a mock transport (the calls supabase-js makes for the same things)."""

import json

import httpx

from adapters.storage import SupabaseAudioStorage, make_audio_storage
from settings import StorageConfig

CONFIG = StorageConfig(
    backend="supabase",
    supabase_url="https://abc123.supabase.co/",
    supabase_secret_key="sb_secret_test",
    bucket="phantom-audio",
    max_audio_bytes=4096,
)


def storage(handler) -> tuple[SupabaseAudioStorage, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    return SupabaseAudioStorage(CONFIG, transport=httpx.MockTransport(record)), seen


async def test_a_signed_upload_url_is_absolute_and_authenticated():
    signed = {"url": "/object/upload/sign/phantom-audio/records/x.m4a?token=t"}
    s, seen = storage(lambda r: httpx.Response(200, json=signed))
    url = await s.upload_url("records/x.m4a", "audio/mp4")
    assert url == "https://abc123.supabase.co/storage/v1/object/upload/sign/phantom-audio/records/x.m4a?token=t"
    (request,) = seen
    assert request.method == "POST" and request.url.path == "/storage/v1/object/upload/sign/phantom-audio/records/x.m4a"
    assert request.headers["apikey"] == "sb_secret_test" and request.headers["authorization"] == "Bearer sb_secret_test"


async def test_head_finds_the_file_in_its_folder_listing():
    listing = [
        {"name": "x.m4a", "updated_at": "2026-11-22T10:00:00Z", "metadata": {"size": 512}},
        {"name": "x.m4a.bak", "metadata": {"size": 1}},
    ]
    s, seen = storage(lambda r: httpx.Response(200, json=listing))
    found = await s.head("records/x.m4a")
    assert found is not None and found.size == 512 and found.last_modified.year == 2026
    assert json.loads(seen[0].content) == {"prefix": "records", "search": "x.m4a", "limit": 100, "offset": 0}


async def test_head_of_a_missing_file_is_none():
    s, _ = storage(lambda r: httpx.Response(200, json=[]))
    assert await s.head("records/missing.m4a") is None


async def test_read_and_delete():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"m4a")
        return httpx.Response(200, json=[])

    s, seen = storage(handler)
    assert await s.read("records/x.m4a") == b"m4a"
    await s.delete("records/x.m4a")
    assert seen[0].url.path == "/storage/v1/object/phantom-audio/records/x.m4a"
    assert seen[1].method == "DELETE" and json.loads(seen[1].content) == {"prefixes": ["records/x.m4a"]}


async def test_list_skips_folders_and_pages():
    first = [{"name": f"{i}.m4a", "created_at": "2026-11-22T10:00:00Z", "metadata": {"size": 1}} for i in range(1000)]
    second = [{"name": "sub", "metadata": None}, {"name": "last.m4a", "metadata": {"size": 2}}]
    pages = iter([first, second])
    s, seen = storage(lambda r: httpx.Response(200, json=next(pages)))
    found = await s.list("records/")
    assert len(found) == 1001 and found[-1].key == "records/last.m4a"
    assert [json.loads(r.content)["offset"] for r in seen] == [0, 1000]


async def test_the_bucket_is_created_private_and_audio_only_once():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(400, json={"error": "Bucket not found"})
        return httpx.Response(200, json={"name": "phantom-audio"})

    s, seen = storage(handler)
    await s.ensure_bucket()
    body = json.loads(seen[1].content)
    assert body["public"] is False and body["file_size_limit"] == 4096 and "audio/mp4" in body["allowed_mime_types"]

    exists, seen = storage(lambda r: httpx.Response(200, json={"id": "phantom-audio"}))
    await exists.ensure_bucket()
    assert len(seen) == 1  # already there: nothing created


def test_the_backend_is_chosen_from_config():
    assert isinstance(make_audio_storage(CONFIG), SupabaseAudioStorage)
    assert make_audio_storage(StorageConfig(backend="supabase")) is None  # not configured: voice off
