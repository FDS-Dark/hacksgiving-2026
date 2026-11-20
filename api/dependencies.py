"""Wires the layers together as FastAPI dependencies.

Each provider is cached, so the engine, its connection pool and the
services are built once per process, not per request. Tests replace any of
them through `app.dependency_overrides`.
"""

import logging
from functools import cache
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status

from databridge.executor import PostgresExecutor
from openai import AsyncOpenAI

from databridge.user import UserDatabridge
from engine.postgres_engine import PostgresDBEngine
from models.user import AppUser, TokenClaims
from services.rout_request import RoutingService
from services.user import UserService
from settings import config

logger = logging.getLogger(__name__)


# --- Data access ---------------------------------------------------------------


@cache
def get_executor() -> PostgresExecutor:
    return PostgresExecutor(PostgresDBEngine())


# --- Services (one per domain) ------------------------------------------------


@cache
def get_user_service() -> UserService:
    return UserService(UserDatabridge(get_executor()))


@cache
def get_routing_service() -> RoutingService:
    if not config.openai.api_key:
        raise RuntimeError("APP__OPENAI__API_KEY is not set")
    client = AsyncOpenAI(api_key=config.openai.api_key, timeout=config.openai.timeout, max_retries=1)
    return RoutingService(client.responses, config.openai.model)


# --- Identity -------------------------------------------------------------------


@cache
def _jwks_client() -> jwt.PyJWKClient:
    if not config.jwt.jwks_url:
        raise RuntimeError("No JWKS URL configured")
    return jwt.PyJWKClient(config.jwt.jwks_url, cache_keys=True)


def _signing_key(token: str) -> Any:
    """Auth0 (or any JWKS issuer) when `jwt.jwks_url` is set; otherwise the
    shared HS256 dev secret."""
    if config.jwt.jwks_url:
        return _jwks_client().get_signing_key_from_jwt(token).key
    return config.jwt.secret


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_token_claims(request: Request) -> TokenClaims:
    """Verifies the bearer access token (signature, expiry, issuer, audience)
    and returns its identity claims. Nothing here trusts a client-sent user id."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise _unauthorized("Missing or invalid Authorization header")

    token = auth_header[len("Bearer "):]
    try:
        payload = jwt.decode(
            token,
            key=_signing_key(token),
            algorithms=[config.jwt.algorithm],
            audience=config.jwt.audience,
            issuer=config.jwt.issuer,
            leeway=config.jwt.leeway,
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError as e:
        # The reason goes to the log, not the caller.
        logger.warning("JWT validation failed: %s", e)
        raise _unauthorized("Invalid or expired access token")

    # Auth0 access tokens carry no profile claims unless an Action adds them,
    # under a namespaced key (APP__JWT__NAME_CLAIM).
    name = payload.get(config.jwt.name_claim) or payload.get("name")
    return TokenClaims(sub=payload["sub"], name=name if isinstance(name, str) else None)


async def get_current_user(
    claims: TokenClaims = Depends(get_token_claims),
    user_service: UserService = Depends(get_user_service),
) -> AppUser:
    """The caller as an app.users row, provisioned on first request."""
    return await user_service.get_or_create(claims)
