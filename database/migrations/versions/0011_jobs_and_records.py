"""A durable job queue (app.jobs) for background work, and Phantom records
(app.records): what a worker captured, and what the pipeline made of it.
The SQL is in 0011_jobs_and_records.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-22
"""

from alembic import context, op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

# Every function 0011_jobs_and_records.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "job_enqueue",
    "job_claim",
    "job_heartbeat",
    "job_complete",
    "job_fail",
    "job_stats",
    "job_prune",
    "record_create",
    "record_get",
    "record_list",
    "record_advance",
    "record_fail",
    "record_retry",
    "record_begin_confirm",
    "record_finish_confirm",
    "record_abort_confirm",
    "record_fail_stalled",
    "record_discard",
)

DOWNGRADE = """
DROP TABLE app.records;
DROP TABLE app.jobs;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
