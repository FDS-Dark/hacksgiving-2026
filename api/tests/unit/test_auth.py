import time

import jwt
import pytest
from fastapi.testclient import TestClient

from tests.helpers import auth_header, make_token
from dependencies import get_user_service
from main import app
from settings import config


class FakeUserService:
    def __init__(self, user):
        self.user = user
        self.seen_claims = []

    async def get_or_create(self, claims):
        self.seen_claims.append(claims)
        return self.user


@pytest.fixture
def client(sample_user):
    fake = FakeUserService(sample_user)
    app.dependency_overrides[get_user_service] = lambda: fake
    yield TestClient(app), fake
    app.dependency_overrides.clear()


def test_health_needs_no_auth():
    response = TestClient(app).get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
    assert response.headers["X-Request-ID"]


def test_missing_token_gives_structured_401():
    response = TestClient(app).get("/v1/me", headers={"X-Request-ID": "req-123"})
    assert response.status_code == 401
    body = response.json()
    assert body["code"] == "unauthenticated"
    assert body["request_id"] == "req-123"


def test_valid_token_resolves_user(client, sample_user):
    test_client, fake = client
    response = test_client.get("/v1/me", headers=auth_header("auth0|user-a", name="A"))
    assert response.status_code == 200
    assert response.json()["id"] == str(sample_user.id)
    assert fake.seen_claims[0].sub == "auth0|user-a"


@pytest.mark.parametrize(
    "token",
    [
        jwt.encode({"sub": "x", "exp": int(time.time()) - 3600}, config.jwt.secret, algorithm="HS256"),
        jwt.encode(
            {"sub": "x", "exp": int(time.time()) + 300}, "a-different-secret-of-at-least-32-bytes", algorithm="HS256"
        ),
        jwt.encode({"exp": int(time.time()) + 300}, config.jwt.secret, algorithm="HS256"),
        make_token() + "tampered",
    ],
    ids=["expired", "bad-signature", "no-sub", "malformed"],
)
def test_rejected_tokens(client, token):
    test_client, fake = client
    response = test_client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["message"] == "Invalid or expired access token"
    assert fake.seen_claims == []


def test_validation_errors_are_structured(client):
    test_client, _ = client
    response = test_client.patch(
        "/v1/me", json={"display_name": "", "timezone": "Mars/Olympus"}, headers=auth_header()
    )
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert {tuple(f["loc"]) for f in body["fields"]} >= {("body", "display_name"), ("body", "timezone")}


def test_blank_jwt_settings_mean_unset():
    # example.env ships APP__JWT__ISSUER= etc.; an empty string must not make
    # PyJWT demand an iss/aud claim the dev token doesn't carry.
    from settings import JWTConfig

    blank = JWTConfig(jwks_url="", audience="  ", issuer="")
    assert (blank.jwks_url, blank.audience, blank.issuer) == (None, None, None)
