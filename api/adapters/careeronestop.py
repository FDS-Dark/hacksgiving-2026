"""CareerOneStop (US Department of Labor): jobs, training programs, and two
public directories, as rows the data loader imports (api/loader).

* Jobs and training programs come from the Web API, which needs the user id
  and token from registration (careeronestop.org/Developers/WebAPI).
  Registration was closed in November 2026; without credentials the loader
  skips these two.
* American Job Centers and youth/reentry programs are public spreadsheet
  downloads (careeronestop.org/Developers/Data/data-downloads.aspx). Their
  file names change with each release, so each is found on its download
  page.

Parsing is separate from fetching, so tests run on recorded payloads.
"""

from __future__ import annotations

import io
import re
from collections.abc import Iterable, Iterator, Mapping
from typing import Any
from urllib.parse import quote, urljoin

import httpx
from openpyxl import load_workbook

from adapters.dates import parse_datetime
from models.case_enums import CaseCategory
from models.loader import ImportedOpportunity, ImportedResource, try_build
from models.opportunity import Audience, OpportunityKind

API = "https://api.careeronestop.org"
SITE = "https://www.careeronestop.org"
# The site refuses generic HTTP-library user agents.
USER_AGENT = "hacksgiving-data-loader/1.0"

JOBS_SOURCE = "careeronestop_jobs"
TRAINING_SOURCE = "careeronestop_training"
JOB_CENTERS_SOURCE = "careeronestop_ajc"
REENTRY_SOURCE = "careeronestop_reentry"

# The jobs API pages through at most 500 rows from the start, 250 at a time.
_JOBS_PAGE = 250
_JOBS_LAST_START = 500
_TRAINING_PAGE = 100

JOB_CENTERS_PAGE = "/Developers/Data/comprehensive-and-affiliate-american-job-centers.aspx"
REENTRY_PAGE = "/Developers/Data/find-youth-and-reentry-programs.aspx"
_JOB_CENTERS_FILE = re.compile(r'href="(/TridionMultimedia/[^"]*_XLS_AJC_Data[^"]*\.xlsx)"', re.IGNORECASE)
_REENTRY_FILE = re.compile(r'href="(/TridionMultimedia/[^"]*_XLS_Service_Provider_Reentry[^"]*\.xlsx)"', re.IGNORECASE)

TRAINING_NOTE = (
    "This program is on Wisconsin's list of training that WIOA funds can pay for. "
    "Ask an American Job Center whether you qualify to take it at no cost."
)


class CareerOneStopError(RuntimeError):
    """A failed request, without the response body or credentials."""


def client(timeout: float, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=timeout, headers={"User-Agent": USER_AGENT}, follow_redirects=True, transport=transport
    )


def _segment(value: str | int) -> str:
    # Path parameters: "Milwaukee, WI" -> "Milwaukee%2C%20WI".
    return quote(str(value), safe="")


async def _get_json(http: httpx.AsyncClient, path: str, token: str) -> Mapping[str, Any]:
    try:
        response = await http.get(API + path, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        raise CareerOneStopError(f"CareerOneStop request failed: {type(exc).__name__}") from None
    if response.status_code == 404:
        # The API answers 404 when nothing matches.
        return {}
    if response.status_code != 200:
        raise CareerOneStopError(f"CareerOneStop answered {response.status_code}")
    body = response.json()
    return body if isinstance(body, Mapping) else {}


# --- Jobs ----------------------------------------------------------------------


async def fetch_jobs(
    http: httpx.AsyncClient,
    *,
    user_id: str,
    token: str,
    keywords: Iterable[str],
    location: str,
    radius_miles: int,
    max_age_days: int,
    limit: int,
) -> list[ImportedOpportunity]:
    """Jobs posted within `max_age_days` near `location`, newest first."""
    found: dict[str, ImportedOpportunity] = {}
    for keyword in keywords:
        for start in range(0, _JOBS_LAST_START + 1, _JOBS_PAGE):
            path = "/v1/jobsearch/" + "/".join(_segment(p) for p in (
                user_id, keyword or "0", location, radius_miles, "acquisitiondate", "DESC", start, _JOBS_PAGE,
                max_age_days,
            ))
            body = await _get_json(http, path, token)
            page = list(parse_jobs(body))
            for job in page:
                found.setdefault(job.external_id, job)
            if len(page) < _JOBS_PAGE or len(found) >= limit:
                break
        if len(found) >= limit:
            break
    return list(found.values())[:limit]


def parse_jobs(body: Mapping[str, Any]) -> Iterator[ImportedOpportunity]:
    for job in body.get("Jobs") or []:
        if not job.get("JvId") or not job.get("JobTitle") or not job.get("Company"):
            continue
        item = try_build(
            ImportedOpportunity,
            source=JOBS_SOURCE,
            external_id=str(job["JvId"]),
            kind=OpportunityKind.JOB,
            title=job["JobTitle"],
            organization=job["Company"],
            description=job.get("DescriptionSnippet"),
            location=job.get("Location"),
            apply_url=job.get("URL"),
            # "Fc": the employer is a fair-chance employer.
            audiences=[Audience.SECOND_CHANCE] if job.get("Fc") is True else [],
            posted_at=parse_datetime(job.get("AcquisitionDate")),
        )
        if item:
            yield item


# --- Training programs -----------------------------------------------------------


async def fetch_training(
    http: httpx.AsyncClient, *, user_id: str, token: str, location: str, radius_miles: int, limit: int
) -> list[ImportedOpportunity]:
    """Training programs near `location` that WIOA can pay for (the state's
    eligible training provider list), which an American Job Center can make
    free for people who qualify."""
    found: dict[str, ImportedOpportunity] = {}
    start = 0
    while len(found) < limit:
        # keyword, location, radius, then the filters (0 = none; W = WIOA
        # eligible training providers), sort, and paging.
        path = "/v2/training/programs/" + "/".join(_segment(p) for p in (
            user_id, "0", location, radius_miles, "0", "0", "0", "0", "0", "W", "0", "0", "0", start,
            _TRAINING_PAGE,
        ))
        body = await _get_json(http, path, token)
        page = list(parse_training(body))
        for program in page:
            found.setdefault(program.external_id, program)
        start += _TRAINING_PAGE
        if len(page) < _TRAINING_PAGE or start >= int(body.get("RecordCount") or 0):
            break
    return list(found.values())[:limit]


def parse_training(body: Mapping[str, Any]) -> Iterator[ImportedOpportunity]:
    for program in body.get("SchoolPrograms") or []:
        title = program.get("EtaProgramName") or program.get("Credential") or program.get("CipTitle")
        if not program.get("DetailId") or not title or not program.get("SchoolName"):
            continue
        formats = ", ".join(f for f in program.get("Format") or [] if f)
        about = ". ".join(p for p in (program.get("AwardLevel"), formats, program.get("CipTitle")) if p)
        item = try_build(
            ImportedOpportunity,
            source=TRAINING_SOURCE,
            external_id=str(program["DetailId"]),
            kind=OpportunityKind.EDUCATION,
            title=title,
            organization=program["SchoolName"],
            description=f"{about}. {TRAINING_NOTE}" if about else TRAINING_NOTE,
            location=_address(program.get("Address"), None, program.get("City"), program.get("StateAbbr"),
                              program.get("Zip")),
            schedule=program.get("AwardLevel"),
            contact_phone=program.get("Phone"),
            apply_url=_url(program.get("SchoolURL")),
        )
        if item:
            yield item


# --- Directory downloads ---------------------------------------------------------


async def download_sheet(http: httpx.AsyncClient, page: str, file_pattern: re.Pattern[str]) -> bytes:
    """The current spreadsheet linked from a data download page."""
    try:
        listing = await http.get(SITE + page)
        listing.raise_for_status()
        match = file_pattern.search(listing.text)
        if not match:
            raise CareerOneStopError(f"No spreadsheet link on {page}")
        sheet = await http.get(urljoin(SITE, match.group(1)))
        sheet.raise_for_status()
    except httpx.HTTPError as exc:
        raise CareerOneStopError(f"CareerOneStop download failed: {type(exc).__name__}") from None
    return sheet.content


async def fetch_job_centers(
    http: httpx.AsyncClient, *, state: str, zip_prefixes: Iterable[str]
) -> list[ImportedResource]:
    content = await download_sheet(http, JOB_CENTERS_PAGE, _JOB_CENTERS_FILE)
    return list(parse_job_centers(content, state, zip_prefixes))


async def fetch_reentry_programs(
    http: httpx.AsyncClient, *, state: str, zip_prefixes: Iterable[str]
) -> list[ImportedResource]:
    content = await download_sheet(http, REENTRY_PAGE, _REENTRY_FILE)
    return list(parse_reentry_programs(content, state, zip_prefixes))


def parse_job_centers(content: bytes, state: str, zip_prefixes: Iterable[str]) -> Iterator[ImportedResource]:
    """American Job Centers: free job search help, career services and
    training referrals."""
    for row in _rows(content):
        if not _in_area(row.get("State"), row.get("Zip Code"), state, zip_prefixes):
            continue
        if _yes(row.get("Center Closure Y/N")) or not row.get("ID") or not row.get("Name of Center"):
            continue
        about = [f"{row.get('Program Type') or 'American Job Center'}: free help finding work, career "
                 "services, and referrals to training."]
        if _yes(row.get("Have Programs for Ex-Offenders")):
            about.append("Has programs for people with a conviction record.")
        item = try_build(
            ImportedResource,
            source=JOB_CENTERS_SOURCE,
            external_id=str(row["ID"]),
            name=row["Name of Center"],
            category=CaseCategory.BRIDGE_TO_EMPLOYMENT,
            description=" ".join(about),
            address=_address(row.get("Address1"), row.get("Address2"), row.get("City"), row.get("State"),
                             row.get("Zip Code")),
            neighborhood=row.get("City"),
            phone=row.get("Phone"),
            website=_url(row.get("Web Site URL")),
            # The spreadsheet spells it "Latitiude".
            latitude=_float(row.get("Latitiude") or row.get("Latitude")),
            longitude=_float(row.get("Longitude")),
        )
        if item:
            yield item


def parse_reentry_programs(content: bytes, state: str, zip_prefixes: Iterable[str]) -> Iterator[ImportedResource]:
    """Programs for young people (16-24) and reentry programs for youth and
    adults leaving incarceration."""
    for row in _rows(content):
        if not _in_area(row.get("State"), row.get("Zip Code"), state, zip_prefixes):
            continue
        if not row.get("ID") or not row.get("Resource"):
            continue
        serves = [label for column, label in (
            ("Reentry Programs for Adults", "adults returning from incarceration"),
            ("Reentry Programs for Youth", "young people returning from incarceration"),
            ("Programs for Youth", "young people 16 to 24"),
        ) if _yes(row.get(column))]
        description = str(row.get("Description") or "").strip()
        if serves:
            description = f"{description} Serves {', '.join(serves)}.".strip()
        item = try_build(
            ImportedResource,
            source=REENTRY_SOURCE,
            external_id=str(row["ID"]),
            name=row["Resource"],
            category=CaseCategory.BRIDGE_TO_EMPLOYMENT,
            description=description,
            address=_address(row.get("Address_1"), row.get("Address_2"), row.get("City"), row.get("State"),
                             row.get("Zip Code")),
            neighborhood=row.get("City"),
            phone=row.get("Phone"),
            website=_url(row.get("WEB Address")),
        )
        if item:
            yield item


def _rows(content: bytes) -> Iterator[dict[str, Any]]:
    """The first sheet's rows as dicts keyed by its header row."""
    book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        rows = book.worksheets[0].iter_rows(values_only=True)
        header = [str(c).strip() if c is not None else "" for c in next(rows, ())]
        for values in rows:
            yield {name: value for name, value in zip(header, values) if name}
    finally:
        book.close()


def _in_area(state: Any, zip_code: Any, want_state: str, zip_prefixes: Iterable[str]) -> bool:
    if str(state or "").strip().upper() != want_state.upper():
        return False
    code = str(zip_code or "").strip()
    return any(code.startswith(prefix) for prefix in zip_prefixes)


def _yes(value: Any) -> bool:
    return str(value or "").strip().lower() in {"y", "yes", "true"}


def _float(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _url(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not text.lower().startswith(("http://", "https://")):
        text = "https://" + text
    return text if " " not in text else None


def _address(line1: Any, line2: Any, city: Any, state: Any, zip_code: Any) -> str | None:
    street = ", ".join(str(p).strip() for p in (line1, line2) if p and str(p).strip())
    place = " ".join(str(p).strip() for p in (state, zip_code) if p and str(p).strip())
    town = ", ".join(p for p in (str(city).strip() if city else "", place) if p)
    return ", ".join(p for p in (street, town) if p) or None
