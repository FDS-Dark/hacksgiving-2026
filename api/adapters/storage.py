"""Object storage for Phantom's audio. Called only from services and the
worker. Two backends, one interface (`AudioStorage`):

- `SupabaseAudioStorage` (production): Supabase Storage's own HTTP API with a
  secret API key. database/terraform creates the key and writes it to Vault,
  so nothing is set up by hand. The bucket is created (private, audio only,
  size-capped) on startup.
- `S3AudioStorage` (local): any S3-compatible store, here the `storage`
  container in database/compose.yaml. boto3 is synchronous, so its calls run
  in a thread; presigning is local computation.

Keys look like `records/<record id>.m4a`: nothing about the person.
"""

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import boto3
import httpx
from botocore.client import Config
from botocore.exceptions import ClientError

from settings import StorageConfig


@dataclass(frozen=True)
class StoredObject:
    key: str
    size: int
    last_modified: datetime


class AudioStorage(Protocol):
    async def upload_url(self, key: str, content_type: str) -> str:
        """A one-time URL the phone PUTs the audio to, with this Content-Type."""
        ...

    async def head(self, key: str) -> StoredObject | None: ...

    async def read(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None:
        """Deleting a key that's already gone succeeds: safe to repeat."""
        ...

    async def list(self, prefix: str) -> list[StoredObject]: ...

    async def ensure_bucket(self) -> None:
        """Create the private bucket if it's missing (safe to repeat)."""
        ...


def make_audio_storage(config: StorageConfig) -> AudioStorage | None:
    """The configured backend, or None (voice off) when it isn't set up."""
    if not config.configured:
        return None
    if config.backend == "supabase":
        return SupabaseAudioStorage(config)
    return S3AudioStorage(config)


# --- Supabase Storage -------------------------------------------------------------


def _parse_time(value: str | None) -> datetime:
    return datetime.fromisoformat((value or "1970-01-01T00:00:00+00:00").replace("Z", "+00:00"))


class SupabaseAudioStorage:
    """Supabase Storage's REST API (the same calls supabase-js makes)."""

    def __init__(self, config: StorageConfig, transport: httpx.AsyncBaseTransport | None = None) -> None:
        assert config.supabase_url and config.supabase_secret_key
        self.config = config
        self.bucket = config.bucket
        self.base = config.supabase_url.rstrip("/") + "/storage/v1"
        key = config.supabase_secret_key
        self._http = httpx.AsyncClient(
            base_url=self.base,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(60.0, connect=10.0),
            transport=transport,
        )

    async def upload_url(self, key: str, content_type: str) -> str:
        response = await self._http.post(f"/object/upload/sign/{self.bucket}/{key}")
        response.raise_for_status()
        # A path relative to /storage/v1 with a one-time token.
        signed: str = response.json()["url"]
        return self.base + signed

    async def head(self, key: str) -> StoredObject | None:
        folder, _, name = key.rpartition("/")
        response = await self._http.post(
            f"/object/list/{self.bucket}", json={"prefix": folder, "search": name, "limit": 100, "offset": 0}
        )
        response.raise_for_status()
        for item in response.json():
            if item.get("name") == name and item.get("metadata"):
                return StoredObject(
                    key=key,
                    size=int(item["metadata"].get("size") or item["metadata"].get("contentLength") or 0),
                    last_modified=_parse_time(item.get("updated_at") or item.get("created_at")),
                )
        return None

    async def read(self, key: str) -> bytes:
        response = await self._http.get(f"/object/{self.bucket}/{key}")
        response.raise_for_status()
        return response.content

    async def delete(self, key: str) -> None:
        response = await self._http.request("DELETE", f"/object/{self.bucket}", json={"prefixes": [key]})
        response.raise_for_status()

    async def list(self, prefix: str) -> list[StoredObject]:
        folder = prefix.rstrip("/")
        found: list[StoredObject] = []
        offset = 0
        while True:
            response = await self._http.post(
                f"/object/list/{self.bucket}",
                json={"prefix": folder, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            )
            response.raise_for_status()
            page = response.json()
            for item in page:
                if item.get("metadata"):  # folders have none
                    found.append(
                        StoredObject(
                            key=f"{folder}/{item['name']}",
                            size=int(item["metadata"].get("size") or 0),
                            last_modified=_parse_time(item.get("updated_at") or item.get("created_at")),
                        )
                    )
            if len(page) < 1000:
                return found
            offset += 1000

    async def ensure_bucket(self) -> None:
        if (await self._http.get(f"/bucket/{self.bucket}")).status_code == 200:
            return
        response = await self._http.post(
            "/bucket",
            json={
                "id": self.bucket,
                "name": self.bucket,
                "public": False,
                "file_size_limit": self.config.max_audio_bytes,
                "allowed_mime_types": ["audio/mp4", "audio/m4a", "audio/x-m4a"],
            },
        )
        # Another replica may have made it a moment ago.
        if response.status_code not in (200, 201) and "already exists" not in json.dumps(response.json()).lower():
            response.raise_for_status()


# --- S3-compatible (local) --------------------------------------------------------


def _client(config: StorageConfig, endpoint: str | None) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=config.region,
        aws_access_key_id=config.access_key_id,
        aws_secret_access_key=config.secret_access_key,
        # Path-style URLs (endpoint/bucket/key).
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )


class S3AudioStorage:
    def __init__(self, config: StorageConfig) -> None:
        self.config = config
        self.bucket = config.bucket
        self._s3 = _client(config, config.endpoint_url)
        self._public = _client(config, config.public_endpoint_url or config.endpoint_url)

    async def upload_url(self, key: str, content_type: str) -> str:
        """Presigned PUT: the upload must send the same Content-Type, and it
        expires after `upload_url_seconds`."""
        url: str = self._public.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=self.config.upload_url_seconds,
        )
        return url

    async def head(self, key: str) -> StoredObject | None:
        try:
            meta = await asyncio.to_thread(self._s3.head_object, Bucket=self.bucket, Key=key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return StoredObject(key=key, size=int(meta["ContentLength"]), last_modified=meta["LastModified"])

    async def read(self, key: str) -> bytes:
        response = await asyncio.to_thread(self._s3.get_object, Bucket=self.bucket, Key=key)
        body: bytes = await asyncio.to_thread(response["Body"].read)
        return body

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._s3.delete_object, Bucket=self.bucket, Key=key)

    async def list(self, prefix: str) -> list[StoredObject]:
        def page_through() -> list[StoredObject]:
            found: list[StoredObject] = []
            for page in self._s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
                for item in page.get("Contents", []):
                    found.append(
                        StoredObject(key=item["Key"], size=int(item["Size"]), last_modified=item["LastModified"])
                    )
            return found

        return await asyncio.to_thread(page_through)

    async def ensure_bucket(self) -> None:
        try:
            await asyncio.to_thread(self._s3.head_bucket, Bucket=self.bucket)
        except ClientError:
            await asyncio.to_thread(self._s3.create_bucket, Bucket=self.bucket)
