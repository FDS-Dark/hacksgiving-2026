"""USAJOBS (developer.usajobs.gov): federal jobs near the loader's location,
as rows the data loader imports (dataloader/).

Only announcements open to the public (hiring path "public"): the others
need current or former federal status. The API wants the key and the email
address it was requested with.

Parsing is separate from fetching, so tests run on recorded payloads.
"""

from collections.abc import Iterator, Mapping
from typing import Any

import httpx

from client.dates import parse_datetime
from model.enums import OpportunityKind
from model.imported import ImportedOpportunity, try_build

SOURCE = "usajobs"
SEARCH_URL = "https://data.usajobs.gov/api/search"
_PAGE = 250
_STATES = {"WI": "Wisconsin", "IL": "Illinois", "MN": "Minnesota", "MI": "Michigan", "IA": "Iowa"}

# RateIntervalCode -> how it reads after a dollar amount.
_INTERVALS = {"PA": "a year", "PH": "an hour", "PD": "a day", "PW": "a week", "BW": "every two weeks",
              "PM": "a month", "WC": "without compensation"}


class USAJobsError(RuntimeError):
    """A failed request, without the response body or credentials."""


def client(
    api_key: str, email: str, timeout: float, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=timeout,
        headers={"Host": "data.usajobs.gov", "User-Agent": email, "Authorization-Key": api_key},
        transport=transport,
    )


def location_name(location: str) -> str:
    """USAJOBS matches "Milwaukee, Wisconsin", not "Milwaukee, WI"."""
    city, _, state = location.partition(",")
    state = state.strip()
    return f"{city.strip()}, {_STATES.get(state.upper(), state)}" if state else city.strip()


async def fetch_jobs(
    http: httpx.AsyncClient, *, location: str, radius_miles: int, max_age_days: int, limit: int
) -> list[ImportedOpportunity]:
    found: dict[str, ImportedOpportunity] = {}
    page = 1
    while len(found) < limit:
        params: dict[str, str | int] = {
            "LocationName": location_name(location), "Radius": radius_miles, "HiringPath": "public",
            "DatePosted": max_age_days, "ResultsPerPage": _PAGE, "Page": page,
        }
        try:
            response = await http.get(SEARCH_URL, params=params)
        except httpx.HTTPError as exc:
            raise USAJobsError(f"USAJOBS request failed: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise USAJobsError(f"USAJOBS answered {response.status_code}")
        body = response.json()
        for job in parse_jobs(body):
            found.setdefault(job.external_id, job)
        pages = int(((body.get("SearchResult") or {}).get("UserArea") or {}).get("NumberOfPages") or 1)
        if page >= pages:
            break
        page += 1
    return list(found.values())[:limit]


def parse_jobs(body: Mapping[str, Any]) -> Iterator[ImportedOpportunity]:
    for item in (body.get("SearchResult") or {}).get("SearchResultItems") or []:
        job = item.get("MatchedObjectDescriptor") or {}
        job_id = item.get("MatchedObjectId") or job.get("PositionID")
        if not job_id or not job.get("PositionTitle") or not job.get("OrganizationName"):
            continue
        details = (job.get("UserArea") or {}).get("Details") or {}
        apply = job.get("ApplyURI") or []
        schedule = job.get("PositionSchedule") or []
        item = try_build(
            ImportedOpportunity,
            source=SOURCE,
            external_id=str(job_id),
            kind=OpportunityKind.JOB,
            title=job["PositionTitle"],
            organization=job["OrganizationName"],
            description=details.get("JobSummary") or job.get("QualificationSummary"),
            location=job.get("PositionLocationDisplay"),
            schedule=schedule[0].get("Name") if schedule else None,
            pay=_pay(job.get("PositionRemuneration") or []),
            apply_url=(apply[0] if apply else None) or job.get("PositionURI"),
            posted_at=parse_datetime(job.get("PublicationStartDate")),
            expires_at=parse_datetime(job.get("ApplicationCloseDate")),
        )
        if item:
            yield item


def _pay(remuneration: list[Mapping[str, Any]]) -> str | None:
    """"$45,000-$60,000 a year" from the first pay range."""
    if not remuneration:
        return None
    first = remuneration[0]
    low, high = _money(first.get("MinimumRange")), _money(first.get("MaximumRange"))
    if low is None and high is None:
        return None
    amount = f"{low}-{high}" if low and high and low != high else (low or high)
    code = str(first.get("RateIntervalCode") or "")
    interval = _INTERVALS.get(code) or str(first.get("Description") or "").lower()
    return f"{amount} {interval}".strip()


def _money(value: Any) -> str | None:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return f"${amount:,.2f}" if amount < 1000 and amount % 1 else f"${amount:,.0f}"
