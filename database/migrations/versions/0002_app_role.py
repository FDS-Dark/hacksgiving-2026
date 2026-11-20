"""The API's least-privileged role and its grants on the `app` schema.

The role name comes from HACKSGIVING_APP_ROLE (default `hacksgiving`). If the role
doesn't exist yet it is created with HACKSGIVING_APP_PASSWORD; an existing role
keeps its password. The API connects as this role, never as the owner.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-19
"""

from alembic import context, op
from sqlalchemy import text

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

GRANTS = """
GRANT CONNECT ON DATABASE {database} TO {role};
GRANT USAGE ON SCHEMA app TO {role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA app TO {role};
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA app TO {role};
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA app TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT                  ON SEQUENCES TO {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE                        ON FUNCTIONS TO {role};
"""

REVOKES = """
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES    FROM {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM {role};
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM {role};
REVOKE ALL ON ALL TABLES    IN SCHEMA app FROM {role};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM {role};
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM {role};
REVOKE USAGE ON SCHEMA app FROM {role};
REVOKE CONNECT ON DATABASE {database} FROM {role};
"""


def _quoted_names() -> dict[str, str]:
    """The role and database names, quoted by PostgreSQL itself."""
    row = op.get_bind().execute(
        text("SELECT quote_ident(:role) AS role, quote_ident(current_database()) AS database"),
        {"role": context.config.attributes["app_role"]},
    ).one()
    return {"role": row.role, "database": row.database}


def upgrade() -> None:
    bind = op.get_bind()
    role = context.config.attributes["app_role"]
    exists = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": role}).first()
    if not exists:
        password = context.config.attributes["app_password"]
        if not password:
            raise RuntimeError(f"Role {role!r} doesn't exist yet; set HACKSGIVING_APP_PASSWORD to create it")
        create = bind.execute(
            text("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', CAST(:role AS text), CAST(:password AS text))"),
            {"role": role, "password": password},
        ).scalar_one()
        run = context.config.attributes["execute_script"]
        run(bind, create)
    context.config.attributes["execute_script"](bind, GRANTS.format(**_quoted_names()))


def downgrade() -> None:
    # The role itself is cluster-wide and may serve other databases, so it stays.
    context.config.attributes["execute_script"](op.get_bind(), REVOKES.format(**_quoted_names()))
