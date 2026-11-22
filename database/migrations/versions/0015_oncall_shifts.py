"""On call: shifts (app.oncall_shifts), who is on now and next, the rota,
and the self-serve "On call" switch. The SQL is in 0015_oncall_shifts.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

# Every function 0015_oncall_shifts.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "oncall_now",
    "oncall_shift_list",
    "oncall_shift_save",
    "oncall_shift_delete",
    "oncall_toggle",
)

DOWNGRADE = """
DROP TABLE app.oncall_shifts;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
