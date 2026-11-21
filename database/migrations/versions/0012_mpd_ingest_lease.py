"""The MPD ingest lease: the API runs ingestion itself, and with several
processes exactly one scrapes per interval. The SQL is in
0012_mpd_ingest_lease.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

# Every function 0012_mpd_ingest_lease.sql creates. test_migrations.py checks
# the union of every revision's list against the database.
FUNCTIONS = ("mpd_ingest_claim",)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + "\nDROP TABLE app.mpd_ingest_lease;")
