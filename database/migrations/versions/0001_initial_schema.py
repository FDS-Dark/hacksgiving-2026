"""Initial schema: the `app` schema and app.users.

The SQL lives in 0001_initial_schema.sql.

Revision ID: 0001
Revises:
Create Date: 2026-11-19
"""

from alembic import context, op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    # The pgcrypto and vector extensions stay: other schemas may use them.
    op.execute("DROP SCHEMA app CASCADE")
