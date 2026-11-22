"""Recently worked: the cases one worker touched most recently, by the last
history entry they wrote (a note, a message, a status change, a finished
task) or opening the case. The Queue's "Recently worked" view reads it. The
SQL is in 0033_recently_worked.sql.

Numbered 0033 because 0030-0032 are taken by branches merging at the same
time; whoever merges last re-points `down_revision` to the head before it.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0033
Revises: 0029
Create Date: 2026-11-22
"""

from alembic import context, op

revision = "0033"
down_revision = "0029"
branch_labels = None
depends_on = None

# Every function 0033_recently_worked.sql creates. test_migrations.py checks
# the union of every revision's list against the database.
FUNCTIONS = ("case_recently_worked",)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    context.config.attributes["execute_script"](
        op.get_bind(),
        "DROP FUNCTION app.case_recently_worked;\nDROP INDEX app.case_updates_author_idx;",
    )
