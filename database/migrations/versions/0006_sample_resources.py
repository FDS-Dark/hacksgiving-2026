"""Sample community resources for demonstrations.

Every row is marked is_sample = true and named "(Sample)"; the phone numbers
are fictional 555-01xx numbers. The worker app labels them. Replace them with
ComForce MKE's real referral partners (POST /v1/resources) and then remove
them with:

    DELETE FROM app.resources r WHERE r.is_sample
      AND NOT EXISTS (SELECT 1 FROM app.case_referrals f WHERE f.resource_id = r.id);

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-20
"""

from alembic import op
from sqlalchemy import text

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# (name, category, description, neighborhood, phone, hours)
SAMPLES = [
    ("Northside Community Pantry (Sample)", "meal_programs",
     "Weekly groceries and a hot meal on Wednesdays. No ID required.", "Harambee", "414-555-0101",
     "Mon, Wed, Fri 10am-4pm"),
    ("Southside Hot Meals (Sample)", "meal_programs",
     "Free dinner every evening; family seating and kids' meals.", "Clarke Square", "414-555-0102",
     "Daily 5pm-7pm"),
    ("Emergency Family Shelter (Sample)", "homelessness",
     "Overnight beds for families with children; call ahead for space.", "Lindsay Heights", "414-555-0103",
     "24/7 intake line"),
    ("Housing Navigation Desk (Sample)", "homelessness",
     "Help with eviction notices, rental assistance applications and housing searches.", "Downtown",
     "414-555-0104", "Mon-Fri 9am-5pm"),
    ("Ride to Care Program (Sample)", "transportation",
     "Free rides to medical appointments, court dates and job interviews. Book a day ahead.", "Citywide",
     "414-555-0105", "Mon-Sat 7am-7pm"),
    ("Bus Pass Assistance (Sample)", "transportation",
     "Weekly transit passes for job seekers and people in treatment.", "Midtown", "414-555-0106",
     "Tue, Thu 10am-2pm"),
    ("Peace Keepers Outreach (Sample)", "violence_prevention",
     "Street outreach workers who mediate conflicts and support people at risk of retaliation.",
     "Sherman Park", "414-555-0107", "Daily 2pm-midnight"),
    ("Family Safety Hotline (Sample)", "violence_prevention",
     "Confidential safety planning and shelter referrals for domestic violence survivors.", "Citywide",
     "414-555-0108", "24/7"),
    ("Crisis De-escalation Team (Sample)", "incident_deescalation",
     "Trained responders who come out to calm a tense situation before it turns violent.", "Citywide",
     "414-555-0109", "24/7 dispatch"),
    ("Missing Persons Family Support (Sample)", "missing_persons",
     "Helps families file reports, make flyers and coordinate community searches.", "Citywide",
     "414-555-0110", "Mon-Fri 8am-6pm"),
    ("Funeral Cost Assistance Fund (Sample)", "burial_assistance",
     "Grants toward funeral and burial costs for families who can't cover them.", "Citywide",
     "414-555-0111", "Mon-Fri 9am-4pm"),
    ("Second Chance Jobs Center (Sample)", "bridge_to_employment",
     "Resume help, interview practice and employer connections, including after incarceration.",
     "Washington Park", "414-555-0112", "Mon-Thu 9am-6pm"),
    ("Youth Job Training Program (Sample)", "bridge_to_employment",
     "Paid 8-week job training for ages 16-24, with a placement at the end.", "Riverwest", "414-555-0113",
     "Mon-Fri 3pm-7pm"),
    ("Neighborhood Resource Hub (Sample)", "other",
     "Walk-in help finding any service: benefits, ID replacement, utilities and more.", "Harambee",
     "414-555-0114", "Mon-Sat 9am-5pm"),
]


def upgrade() -> None:
    insert = text("""
        INSERT INTO app.resources (name, category, description, neighborhood, phone, hours, is_sample)
        VALUES (:name, :category, :description, :neighborhood, :phone, :hours, true)
    """)
    for name, category, description, neighborhood, phone, hours in SAMPLES:
        op.get_bind().execute(insert, {"name": name, "category": category, "description": description,
                                       "neighborhood": neighborhood, "phone": phone, "hours": hours})


def downgrade() -> None:
    # Referrals to a sample resource go with it.
    op.get_bind().execute(text("""
        DELETE FROM app.case_referrals f USING app.resources r WHERE f.resource_id = r.id AND r.is_sample
    """))
    op.get_bind().execute(text("DELETE FROM app.resources r WHERE r.is_sample"))
