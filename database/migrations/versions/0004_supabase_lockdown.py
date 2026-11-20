"""Supabase project setup: nothing exposed by default.

Runs only where the Supabase roles exist (anon, authenticated). Plain
Postgres, used locally and by the tests, skips it. The SQL lives in
0004_supabase_lockdown.sql.

New tables, sequences and functions that postgres creates in public are not
granted to anon or authenticated, so nothing becomes reachable through the
Data API by accident (it's also switched off; see database/terraform).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-19
"""

from alembic import context

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    # A hardening; not reverted.
    pass
