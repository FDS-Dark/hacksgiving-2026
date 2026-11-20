"""Production refuses configurations that would accept forged tokens."""

import pytest
from pydantic import ValidationError

from settings import DEV_JWT_SECRET, AppConfig, EnvironmentConfig, JWTConfig


def _config(**jwt) -> AppConfig:
    return AppConfig(environment=EnvironmentConfig(name="production"), jwt=JWTConfig(**{"jwks_url": "", **jwt}))


def test_production_rejects_the_dev_secret():
    with pytest.raises(ValidationError, match="Production needs"):
        _config(algorithm="HS256", secret=DEV_JWT_SECRET)


def test_production_rejects_a_short_secret():
    with pytest.raises(ValidationError):
        _config(algorithm="HS256", secret="too-short")


def test_production_accepts_auth0_or_a_real_secret():
    assert _config(jwks_url="https://tenant.example/.well-known/jwks.json", algorithm="RS256").jwt.algorithm == "RS256"
    assert _config(algorithm="HS256", secret="x" * 40).jwt.secret == "x" * 40


def test_dev_may_use_the_dev_secret():
    assert AppConfig(environment={"name": "dev"}, jwt={"jwks_url": ""}).jwt.secret == DEV_JWT_SECRET
