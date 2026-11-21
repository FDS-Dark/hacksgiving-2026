"""Public data the loader imports: reviewed incidents (NIBRS), dispatch
signals (MPD and MFD calls), boundaries, MCTS transit, NWS weather alerts,
CDC PLACES measures and FBI crime trends, and a log of loader runs. The SQL
is in 0013_public_data.sql; docs/data-loader.md describes the job.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

# Every function 0013_public_data.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "loader_run_record",
    "loader_run_latest",
    "geo_area_sync",
    "geo_area_list",
    "external_incident_sync",
    "public_incident_points",
    "public_incident_tract_counts",
    "external_signal_sync",
    "public_signal_list",
    "transit_route_sync",
    "transit_stop_sync",
    "transit_alert_sync",
    "transit_stops_near",
    "transit_alert_active",
    "weather_alert_sync",
    "weather_alert_active",
    "community_measure_sync",
    "community_measure_list",
    "crime_trend_sync",
    "crime_trend_list",
    "public_data_retire",
)

TABLES = (
    "crime_trends",
    "community_measures",
    "weather_alerts",
    "transit_alerts",
    "transit_stops",
    "transit_routes",
    "external_signals",
    "external_incidents",
    "geo_areas",
    "loader_runs",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    tables = "\n".join(f"DROP TABLE app.{name};" for name in TABLES)
    context.config.attributes["execute_script"](op.get_bind(), drops + "\n" + tables)
