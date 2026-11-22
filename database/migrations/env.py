"""Alembic environment for Hacksgiving.

Settings come from the environment, or from `config.attributes` when Alembic
is driven from Python (the integration tests do this):

- HACKSGIVING_MIGRATION_DATABASE_URL: the schema owner's connection, e.g.
  postgresql://hacksgiving_owner:...@localhost:5432/hacksgiving. Not the app's role.
- HACKSGIVING_APP_ROLE / HACKSGIVING_APP_PASSWORD: the least-privileged role the API
  connects as. Revision 0002 creates it if it doesn't exist and grants it
  access to the `app` schema.

There are no SQLAlchemy models: every revision runs explicit SQL, so
`alembic revision --autogenerate` has nothing to compare against.
"""

import os
from pathlib import Path

from alembic import context, op
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import Connection, make_url

config = context.config


def _setting(name: str, env: str, default: str | None = None) -> str | None:
    return config.attributes.get(name) or os.environ.get(env) or default


def _database_url() -> str:
    url = _setting("url", "HACKSGIVING_MIGRATION_DATABASE_URL")
    if not url:
        raise RuntimeError("Set HACKSGIVING_MIGRATION_DATABASE_URL to the schema owner's connection URL")
    # Migrations use the synchronous psycopg driver: it can run a whole SQL
    # file in one call, which asyncpg's prepared statements can't.
    return make_url(url).set(drivername="postgresql+psycopg").render_as_string(hide_password=False)


config.attributes["app_role"] = _setting("app_role", "HACKSGIVING_APP_ROLE", "hacksgiving")
config.attributes["app_password"] = _setting("app_password", "HACKSGIVING_APP_PASSWORD")


def run_sql_file(revision_file: str) -> None:
    """Run the .sql file that sits next to a revision as one batch."""
    sql = Path(revision_file).with_suffix(".sql").read_text(encoding="utf-8")
    execute_script(op.get_bind(), sql)


def execute_script(connection: Connection, sql: str) -> None:
    """Run SQL on the DBAPI cursor with no parameters at all, inside the
    migration's transaction. psycopg then leaves the script's own % and :
    characters (format(), RAISE, casts) alone; SQLAlchemy's execute paths
    always pass a parameter set, which makes psycopg parse them."""
    with connection.connection.cursor() as cursor:
        cursor.execute(sql)


config.attributes["run_sql_file"] = run_sql_file
config.attributes["execute_script"] = execute_script


def _repair_0030_collision(connection: Connection) -> None:
    """The data loader's rate gate first reached staging as revision 0030, the
    same id as main's 0030_voice_directory_referrals; it is now 0031. A
    database that ran the loader's 0030 says it is at 0030 but lacks main's
    0030 (its function voice_directory_resource_list). Put such a database
    back at 0029 so the upgrade applies main's 0030, then re-runs the loader
    revision, which is idempotent. Does nothing anywhere else."""
    with connection.connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.alembic_version') IS NOT NULL")
        row = cursor.fetchone()
        if row and row[0]:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM public.alembic_version WHERE version_num = '0030')"
                " AND to_regprocedure('app.loader_run_gate(text)') IS NOT NULL"
                " AND to_regproc('app.voice_directory_resource_list') IS NULL"
            )
            row = cursor.fetchone()
            if row and row[0]:
                cursor.execute("UPDATE public.alembic_version SET version_num = '0029'")
    connection.commit()


def run_migrations_online() -> None:
    engine = create_engine(_database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        _repair_0030_collision(connection)
        # Each revision commits on its own, so a failure names the revision
        # that broke and leaves earlier ones applied.
        context.configure(connection=connection, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    # Revision 0002 looks up existing roles, so there's no static SQL to print.
    raise RuntimeError("Offline (--sql) mode isn't supported; run against a database")
run_migrations_online()
