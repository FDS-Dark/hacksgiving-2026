"""The Alembic migrations in database/migrations upgrade, downgrade and
upgrade again cleanly on an empty database, and the API's stored functions
are exactly the ones revision 0003 declares."""

import asyncio
import importlib.util
from types import ModuleType

import asyncpg
from alembic.config import Config
from alembic.script import ScriptDirectory

from tests.integration.conftest import DATABASE_DIR, _db_url, alembic


def _fetch(database: str, sql: str) -> list[tuple]:
    async def run() -> list[tuple]:
        conn = await asyncpg.connect(_db_url(database))
        try:
            return [tuple(row) for row in await conn.fetch(sql)]
        finally:
            await conn.close()

    return asyncio.run(run())


def _head() -> str:
    head = ScriptDirectory.from_config(
        Config(str(DATABASE_DIR / "alembic.ini"))
    ).get_current_head()
    assert head
    return head


def _revision(name: str) -> ModuleType:
    path = DATABASE_DIR / "migrations" / "versions" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


APP_TABLES = """
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'app' ORDER BY table_name
"""

# Functions the API calls. Trigger functions belong to the schema's own
# rules, not to the API.
API_FUNCTIONS = """
    SELECT p.proname FROM pg_proc p
    WHERE p.pronamespace = 'app'::regnamespace AND p.prorettype <> 'trigger'::regtype
    ORDER BY p.proname
"""


def test_migrations_round_trip(empty_database):
    alembic(empty_database, "upgrade", "head")
    assert _fetch(empty_database, "SELECT version_num FROM alembic_version") == [
        (_head(),)
    ]
    tables = [name for (name,) in _fetch(empty_database, APP_TABLES)]
    assert {"users", "cases", "case_updates", "resources", "case_referrals"} <= set(
        tables
    )

    alembic(empty_database, "downgrade", "base")
    assert _fetch(empty_database, "SELECT version_num FROM alembic_version") == []
    assert (
        _fetch(empty_database, "SELECT 1 FROM pg_namespace WHERE nspname = 'app'") == []
    )

    alembic(empty_database, "upgrade", "head")
    assert [name for (name,) in _fetch(empty_database, APP_TABLES)] == tables


def test_every_api_function_is_declared_for_the_downgrade(empty_database):
    """Each revision's downgrade drops the functions it lists; one missing
    from the lists would survive a downgrade and break the next upgrade. A
    later revision that adds functions adds its file here."""
    alembic(empty_database, "upgrade", "head")
    created = {name for (name,) in _fetch(empty_database, API_FUNCTIONS)}
    declared = {
        name
        for revision in (
            "0003_api_functions",
            "0005_case_management",
            "0007_voice_coordination",
            "0008_get_help",
            "0009_case_tasks_resource_coordinates",
            "0010_opportunities",
            "0011_jobs_and_records",
            "0012_voice_referral_history",
            "0013_data_loader",
            "0014_public_data",
            "0015_oncall_shifts",
            "0016_notifications",
            "0017_push",
            "0018_urgent_alerts",
            "0019_case_debriefs",
            "0020_shift_handoffs",
            "0021_person_cases",
        )
        for name in _revision(revision).FUNCTIONS
    }
    assert created == declared


def test_the_app_role_can_run_every_api_function(database):
    """Revision 0002's grants cover functions created after it."""
    rows = _fetch(
        database,
        """
        SELECT p.proname FROM pg_proc p
        WHERE p.pronamespace = 'app'::regnamespace AND p.prorettype <> 'trigger'::regtype
          AND NOT has_function_privilege('hacksgiving_test_app', p.oid, 'EXECUTE')
        """,
    )
    assert rows == []
