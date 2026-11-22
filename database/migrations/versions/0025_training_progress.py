"""Worker training progress (app.training_progress): which course modules
each staff member has finished. The SQL is in 0025_training_progress.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

# Every function 0025_training_progress.sql creates. test_migrations.py checks
# the union of every revision's list against the database.
FUNCTIONS = ("training_progress_list", "training_progress_set", "training_team")


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + "\nDROP TABLE app.training_progress;")
