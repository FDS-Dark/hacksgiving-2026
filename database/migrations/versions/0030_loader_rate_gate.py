"""The data loader's rate gate: app.loader_runs marks rate-limited attempts,
loader_run_record records the mark, and loader_run_gate tells a loader when a
source last asked its server. The SQL is in 0030_loader_rate_gate.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-22
"""

from alembic import context, op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

# Every function 0030_loader_rate_gate.sql creates. loader_run_record is
# 0014's, replaced here with a new optional argument; the downgrade puts
# 0014's definition back. test_migrations.py checks the union of every
# revision's list against the database.
FUNCTIONS = ("loader_run_gate",)

DOWNGRADE = """
DROP FUNCTION app.loader_run_record;
CREATE FUNCTION app.loader_run_record(
    p_source TEXT, p_target TEXT, p_status TEXT, p_started_at TIMESTAMPTZ, p_fetched INTEGER,
    p_written INTEGER, p_retired INTEGER, p_detail TEXT)
RETURNS SETOF app.loader_runs
LANGUAGE sql AS $$
    DELETE FROM app.loader_runs r WHERE r.finished_at < now() - INTERVAL '30 days';
    INSERT INTO app.loader_runs AS r (source, target, status, started_at, fetched, written, retired, detail)
    VALUES (p_source, p_target, p_status, p_started_at, p_fetched, p_written, p_retired,
            left(coalesce(p_detail, ''), 500))
    RETURNING r.*;
$$;
DROP INDEX app.loader_runs_source_started_idx;
ALTER TABLE app.loader_runs DROP COLUMN rate_limited;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
