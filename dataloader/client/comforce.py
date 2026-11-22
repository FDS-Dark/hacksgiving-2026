"""Reviewed Milwaukee services shared by the phone navigator and app.

These are deliberately static rather than scraped: ComForce controls when a
public contact is approved for referral. The loader still upserts them on each
daily run so the general resource directory contains the same destinations as
the voice experience. Emergency 911 is intentionally excluded; the app and
phone agent handle it as an immediate action, never as a routine referral.
"""

from model.enums import CaseCategory
from model.imported import ImportedResource

SOURCE = "comforce_reviewed"


def resources() -> list[ImportedResource]:
    return [
        ImportedResource(
            source=SOURCE,
            external_id="milwaukee-mobile-crisis",
            name="Milwaukee Mobile Crisis",
            category=CaseCategory.INCIDENT_DEESCALATION,
            description=(
                "Non-police mental-health crisis response for people of all ages "
                "in Milwaukee County. Call 911 instead when anyone is in immediate danger."
            ),
            phone="+14142577222",
            website="https://county.milwaukee.gov/EN/DHHS/BHD/Milwaukee-Mobile-Crisis",
            hours="24/7",
            neighborhood="Milwaukee County",
        ),
        ImportedResource(
            source=SOURCE,
            external_id="mpd-non-emergency",
            name="Milwaukee Police Non-Emergency",
            category=CaseCategory.OTHER,
            description=(
                "Police reports and assistance when no crime or immediate danger is in progress. "
                "Call 911 for emergencies."
            ),
            phone="+14149334444",
            website="https://city.milwaukee.gov/not911",
            hours="24/7",
            neighborhood="City of Milwaukee",
        ),
        ImportedResource(
            source=SOURCE,
            external_id="milwaukee-city-services",
            name="Milwaukee City Services",
            category=CaseCategory.OTHER,
            description=(
                "City information and non-emergency service requests for property, sanitation, "
                "streets, water, and other City services."
            ),
            phone="+14142862489",
            website="https://city.milwaukee.gov/dpw/AdministrativeServices/general/286CITY",
            hours="24/7",
            neighborhood="City of Milwaukee",
        ),
    ]
