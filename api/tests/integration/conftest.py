"""Integration tests against a real PostgreSQL + pgvector server.

Set HACKSGIVING_TEST_DATABASE_URL to a superuser connection on a disposable server,
e.g. postgresql://hacksgiving_owner:hacksgiving_owner@localhost:5432/postgres. Each test
session creates a fresh database, runs the Alembic migrations in
database/migrations to head, and drops it afterwards. Without the variable
these tests are skipped.
"""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine

from databridge.case import CaseDatabridge
from databridge.executor import PostgresExecutor
from databridge.job import JobDatabridge
from databridge.record import RecordDatabridge
from databridge.resource import ResourceDatabridge
from databridge.staff import StaffDatabridge
from databridge.opportunity import OpportunityDatabridge
from databridge.task import TaskDatabridge
from databridge.user import UserDatabridge
from dependencies import (
    get_case_assistant,
    get_case_service,
    get_opportunity_service,
    get_job_service,
    get_record_service,
    get_resource_service,
    get_staff_service,
    get_task_service,
    get_triager,
    get_user_service,
)
from engine.base_engine import BaseEngine
from engine.postgres_engine import create_postgres_engine
from main import app
from services.case import CaseService
from services.opportunity import OpportunityService
from services.job import JobService
from services.record import RecordService
from services.resource import ResourceService
from services.staff import StaffService
from services.task import TaskService
from services.user import UserService

DATABASE_DIR = Path(__file__).resolve().parents[3] / "database"
ADMIN_URL = os.environ.get("HACKSGIVING_TEST_DATABASE_URL")
APP_ROLE, APP_PASSWORD = "hacksgiving_test_app", "hacksgiving_test_app"


def alembic(database: str, *args: str) -> None:
    """Run an Alembic command (e.g. "upgrade", "head") against a test database."""
    from alembic import command
    from alembic.config import Config

    config = Config(str(DATABASE_DIR / "alembic.ini"))
    config.attributes.update(url=_db_url(database), app_role=APP_ROLE, app_password=APP_PASSWORD)
    name, *rest = args
    getattr(command, name)(config, *rest)


def _db_url(database: str, user: str | None = None, password: str | None = None) -> str:
    assert ADMIN_URL, "HACKSGIVING_TEST_DATABASE_URL not set"
    url = make_url(ADMIN_URL).set(database=database)
    if user:
        url = url.set(username=user, password=password)
    return url.render_as_string(hide_password=False)


async def _create_database(database: str) -> None:
    admin = await asyncpg.connect(_db_url("postgres"))
    try:
        # template0 accepts no connections, so it's never "being accessed by other
        # users" (template1 sometimes is in CI, which failed every test).
        await admin.execute(f'CREATE DATABASE "{database}" TEMPLATE template0')
    finally:
        await admin.close()


async def _drop_database(database: str) -> None:
    admin = await asyncpg.connect(_db_url("postgres"))
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
    finally:
        await admin.close()


@pytest.fixture(scope="session")
def database():
    if not ADMIN_URL:
        pytest.skip("HACKSGIVING_TEST_DATABASE_URL not set")
    name = f"hacksgiving_test_{uuid4().hex[:8]}"
    asyncio.run(_create_database(name))
    alembic(name, "upgrade", "head")
    yield name
    asyncio.run(_drop_database(name))


@pytest.fixture
def empty_database():
    """A fresh database with no migrations applied, dropped afterwards."""
    if not ADMIN_URL:
        pytest.skip("HACKSGIVING_TEST_DATABASE_URL not set")
    name = f"hacksgiving_test_{uuid4().hex[:8]}"
    asyncio.run(_create_database(name))
    yield name
    asyncio.run(_drop_database(name))


@pytest.fixture
async def admin_conn(database):
    """Superuser connection for direct schema/constraint checks."""
    conn = await asyncpg.connect(_db_url(database))
    yield conn
    await conn.close()


class UrlEngine(BaseEngine):
    """An engine for a plain postgresql:// URL (the test database)."""

    def __init__(self, url: str) -> None:
        self.url = make_url(url).set(drivername="postgresql+asyncpg")
        super().__init__()

    def create_engine(self) -> AsyncEngine:
        return create_postgres_engine(self.url)

    def _make_url(self) -> URL:
        return self.url


def app_executor(database: str) -> PostgresExecutor:
    """The executor the API would have, connected as the least-privileged
    application role (the same grants production uses)."""
    return PostgresExecutor(UrlEngine(_db_url(database, APP_ROLE, APP_PASSWORD)))


@pytest.fixture
async def api(database):
    """An HTTP client for the app, wired to the test database as the app role."""
    executor = app_executor(database)
    staff = StaffService(StaffDatabridge(executor))
    tasks = TaskService(TaskDatabridge(executor), staff)
    resources = ResourceService(ResourceDatabridge(executor))
    cases = CaseService(CaseDatabridge(executor), resources, staff, tasks)
    # Every service the routers use, so no test reaches api/.env's database.
    # No AI in integration tests: triage and the assistant are off.
    app.dependency_overrides.update({
        get_user_service: lambda: UserService(UserDatabridge(executor)),
        get_staff_service: lambda: staff,
        get_case_service: lambda: cases,
        get_resource_service: lambda: resources,
        get_task_service: lambda: tasks,
        get_opportunity_service: lambda: OpportunityService(OpportunityDatabridge(executor)),
        get_triager: lambda: None,
        get_case_assistant: lambda: None,
        get_record_service: lambda: RecordService(
            RecordDatabridge(executor), JobDatabridge(executor), executor, cases, tasks
        ),
        get_job_service: lambda: JobService(JobDatabridge(executor)),
    })
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await executor.dispose()
