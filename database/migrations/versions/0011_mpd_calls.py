"""Milwaukee Police Department calls for service, scraped every two minutes
by api/scripts/ingest_mpd_calls.py, with a geocode cache and a log of
ingestion runs. The SQL is in 0011_mpd_calls.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

# Every function 0011_mpd_calls.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "mpd_calls_upsert",
    "mpd_calls_recent",
    "mpd_geocode_lookup",
    "mpd_geocode_save",
    "mpd_ingest_record",
    "mpd_ingest_status",
    "mpd_calls_prune",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](
        op.get_bind(),
        drops + "\nDROP TABLE app.mpd_ingest_runs;\nDROP TABLE app.mpd_geocodes;\nDROP TABLE app.mpd_calls;",
    )
