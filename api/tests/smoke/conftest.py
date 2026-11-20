"""Post-deploy smoke tests: the real API, through the real tunnel, signed in
with a real Auth0 token, using the real database.

Skipped unless HACKSGIVING_SMOKE_BASE_URL is set (e.g. https://hacksgiving-api.example/v1).
Credentials (the Hacksgiving E2E Auth0 app, Vault secret/deployments/hacksgiving/e2e):
HACKSGIVING_SMOKE_AUTH0_DOMAIN, HACKSGIVING_SMOKE_CLIENT_ID, HACKSGIVING_SMOKE_CLIENT_SECRET,
HACKSGIVING_SMOKE_AUDIENCE. CI's smoke-production job sets them all.

The E2E identity is one long-lived user; tests leave it as they found it."""

import os

import httpx
import pytest

BASE_URL = os.environ.get("HACKSGIVING_SMOKE_BASE_URL", "").rstrip("/")


def pytest_collection_modifyitems(config, items):
    if BASE_URL:
        return
    skip = pytest.mark.skip(reason="HACKSGIVING_SMOKE_BASE_URL not set (post-deploy smoke tests)")
    for item in items:
        if "tests/smoke" in item.nodeid.replace("\\", "/"):
            item.add_marker(skip)


@pytest.fixture(scope="session")
def access_token() -> str:
    names = ("AUTH0_DOMAIN", "CLIENT_ID", "CLIENT_SECRET", "AUDIENCE")
    env = {name: os.environ.get(f"HACKSGIVING_SMOKE_{name}", "") for name in names}
    if missing := [name for name, value in env.items() if not value]:
        pytest.fail(f"Missing HACKSGIVING_SMOKE_{', HACKSGIVING_SMOKE_'.join(missing)}")
    response = httpx.post(
        f"https://{env['AUTH0_DOMAIN']}/oauth/token",
        json={
            "grant_type": "client_credentials",
            "client_id": env["CLIENT_ID"],
            "client_secret": env["CLIENT_SECRET"],
            "audience": env["AUDIENCE"],
        },
        timeout=30,
    )
    # Never echo the response body: on success it is the token.
    assert response.status_code == 200, f"Auth0 token request failed: HTTP {response.status_code}"
    return response.json()["access_token"]


@pytest.fixture
async def api(access_token):
    async with httpx.AsyncClient(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {access_token}", "User-Agent": "hacksgiving-smoke-test"},
        timeout=httpx.Timeout(30, read=120),
    ) as client:
        yield client
