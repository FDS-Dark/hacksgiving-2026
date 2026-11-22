"""Integration tests against a real PostgreSQL + pgvector server, the same
way api/tests/integration does it.

Set HACKSGIVING_TEST_DATABASE_URL to a superuser connection on a disposable
server, e.g. postgresql://hacksgiving_owner:hacksgiving_owner@localhost:5432/postgres.
The session creates a fresh database, runs database/'s Alembic migrations to
head, connects the loader as the least-privileged app role (the grants
production uses), and drops the database afterwards. Without the variable
these tests are skipped.
"""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from databridge.executor import PostgresExecutor
from dependencies import create_engine

DATABASE_DIR = Path(__file__).resolve().parents[3] / "database"
ADMIN_URL = os.environ.get("HACKSGIVING_TEST_DATABASE_URL")
APP_ROLE, APP_PASSWORD = "hacksgiving_test_app", "hacksgiving_test_app"


def _db_url(database: str, user: str | None = None, password: str | None = None) -> str:
    assert ADMIN_URL, "HACKSGIVING_TEST_DATABASE_URL not set"
    url = make_url(ADMIN_URL).set(database=database)
    if user:
        url = url.set(username=user, password=password)
    return url.render_as_string(hide_password=False)


def _migrate(database: str) -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(DATABASE_DIR / "alembic.ini"))
    config.attributes.update(url=_db_url(database), app_role=APP_ROLE, app_password=APP_PASSWORD)
    command.upgrade(config, "head")


async def _admin(statement: str) -> None:
    admin = await asyncpg.connect(_db_url("postgres"))
    try:
        await admin.execute(statement)
    finally:
        await admin.close()


@pytest.fixture(scope="session")
def database():
    if not ADMIN_URL:
        pytest.skip("HACKSGIVING_TEST_DATABASE_URL not set")
    name = f"hacksgiving_loader_test_{uuid4().hex[:8]}"
    # template0 accepts no connections, so it's never "being accessed by other users".
    asyncio.run(_admin(f'CREATE DATABASE "{name}" TEMPLATE template0'))
    try:
        _migrate(name)
        yield name
    finally:
        asyncio.run(_admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


@pytest.fixture
async def admin_conn(database):
    """Superuser connection, for reading what the loader wrote."""
    conn = await asyncpg.connect(_db_url(database))
    yield conn
    await conn.close()


@pytest.fixture
async def executor(database):
    """The executor the loader would have, connected as the app role."""
    url = make_url(_db_url(database, APP_ROLE, APP_PASSWORD)).set(drivername="postgresql+asyncpg")
    engine = create_engine(url)
    yield PostgresExecutor(engine)
    await engine.dispose()
