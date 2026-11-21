"""Wires the layers together as FastAPI dependencies.

Each provider is cached, so the engine, its connection pool and the
services are built once per process, not per request. Tests replace any of
them through `app.dependency_overrides`.
"""

import hmac
import logging
from functools import cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException, Request, status

from openai import AsyncOpenAI

from databridge.case import CaseDatabridge
from databridge.executor import PostgresExecutor
from databridge.mpd_call import MpdCallDatabridge
from databridge.opportunity import OpportunityDatabridge
from databridge.resource import ResourceDatabridge
from databridge.staff import StaffDatabridge
from databridge.task import TaskDatabridge
from databridge.user import UserDatabridge
from databridge.voice import VoiceDatabridge
from engine.postgres_engine import PostgresDBEngine
from errors import ApiError
from models.staff import StaffMember
from models.user import AppUser, TokenClaims
from services.case import CaseService, Triager
from services.case_assist import CaseAssistant, triage_with
from services.mpd_calls import MpdCallService
from services.opportunity import OpportunityService
from services.resource import ResourceService
from services.routing import RoutingService
from services.staff import StaffService
from services.task import TaskService
from services.user import UserService
from services.voice import VoiceService
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
def get_staff_service() -> StaffService:
    return StaffService(StaffDatabridge(get_executor()))


@cache
def get_task_service() -> TaskService:
    return TaskService(TaskDatabridge(get_executor()), get_staff_service())


@cache
def get_resource_service() -> ResourceService:
    return ResourceService(ResourceDatabridge(get_executor()))


@cache
def get_case_service() -> CaseService:
    return CaseService(
        CaseDatabridge(get_executor()), get_resource_service(), get_staff_service(), get_task_service()
    )


@cache
def get_opportunity_service() -> OpportunityService:
    return OpportunityService(OpportunityDatabridge(get_executor()))


@cache
def get_mpd_call_service() -> MpdCallService:
    return MpdCallService(MpdCallDatabridge(get_executor()))


@cache
def get_voice_service() -> VoiceService:
    executor = get_executor()
    return VoiceService(VoiceDatabridge(executor), executor)


@cache
def _openai() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=config.openai.api_key, timeout=config.openai.timeout, max_retries=1)


@cache
def get_routing_service() -> RoutingService:
    if not config.openai.api_key:
        raise RuntimeError("APP__OPENAI__API_KEY is not set")
    return RoutingService(_openai().responses, config.openai.model)


# The AI extras are optional: with no APP__OPENAI__API_KEY these give None,
# and the case workflow carries on without them.


@cache
def get_case_assistant() -> CaseAssistant | None:
    return CaseAssistant(_openai().responses, config.openai.model) if config.openai.api_key else None


@cache
def get_triager() -> Triager | None:
    return triage_with(get_routing_service()) if config.openai.api_key else None


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


async def get_current_worker(
    user: AppUser = Depends(get_current_user),
    staff: StaffService = Depends(get_staff_service),
) -> StaffMember:
    """The caller, who must be ComForce staff (role worker or admin); 403 otherwise."""
    return await staff.require_worker(user)


async def get_current_admin(
    user: AppUser = Depends(get_current_user),
    staff: StaffService = Depends(get_staff_service),
) -> StaffMember:
    """The caller, who must be a staff admin; 403 otherwise."""
    return await staff.require_admin(user)


def require_tool_secret(
    supplied: Annotated[str | None, Header(alias="X-Voice-Tool-Secret")] = None,
) -> None:
    """The ElevenLabs voice agent's tool calls carry a shared secret, not a
    user token (routers/voice.py)."""
    expected = config.voice.tool_secret
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise ApiError(401, "invalid_tool_secret", "Invalid voice tool credentials")
