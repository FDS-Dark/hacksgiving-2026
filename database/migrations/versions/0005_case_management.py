"""Case management for ComForce MKE workers: cases, their activity history,
community resources and referrals, and a staff role on app.users. The
schema and its functions are in 0005_case_management.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-20
"""

from alembic import context, op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# Every function 0005_case_management.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "staff_get",
    "staff_list_workers",
    "staff_list_users",
    "staff_set_role",
    "staff_bootstrap",
    "case_create",
    "case_list",
    "case_get",
    "case_update",
    "case_add_update",
    "case_list_updates",
    "case_recent_activity",
    "case_stats",
    "case_counts_by_category",
    "case_counts_by_status",
    "request_list_for_user",
    "request_get_for_user",
    "request_list_updates_for_user",
    "resource_list",
    "resource_get",
    "resource_create",
    "referral_list",
    "referral_add",
    "referral_update",
)

DOWNGRADE = """
DROP VIEW app.referral_view;
DROP VIEW app.case_update_view;
DROP VIEW app.case_view;
DROP TABLE app.case_referrals;
DROP TABLE app.resources;
DROP TABLE app.case_updates;
DROP TABLE app.cases;
ALTER TABLE app.users DROP COLUMN role;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
