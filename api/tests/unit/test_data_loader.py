"""The data loader without a network or a database: the sources' payloads
become rows, and the runner decides what to write and what to close.
tests/integration/test_data_loader_flows.py runs the sync functions."""

import io
from collections import Counter
from datetime import UTC, datetime

import httpx
import pytest
from openpyxl import Workbook

from adapters import careeronestop, usajobs
from adapters.dates import parse_datetime
from loader.runner import Status, opportunity_fingerprint, run
from loader.sources import Source, Target
from models.case_enums import CaseCategory
from models.loader import ImportedOpportunity, ImportedResource, SyncResult
from models.opportunity import Audience, OpportunityKind
from settings import LoaderConfig

NOW = datetime(2026, 11, 21, 12, tzinfo=UTC)


# --- CareerOneStop jobs ----------------------------------------------------------

JOBS = {
    "JobCount": "3",
    "Jobs": [
        {"JvId": "abc", "JobTitle": "Line Cook", "Company": "Northside Kitchen",
         "DescriptionSnippet": "Prep   and\nline work.", "AcquisitionDate": "2026-11-20T06:24:04-05:00",
         "URL": "https://de.jobsyn.org/abc", "Location": "Milwaukee, WI", "Fc": True},
        {"JvId": "def", "JobTitle": "x" * 300, "Company": "Lakefront Co", "URL": "not a link",
         "Location": "Milwaukee, WI", "Fc": False},
        {"JvId": "", "JobTitle": "No id", "Company": "Skipped"},
    ],
}


def test_careeronestop_jobs_tag_fair_chance_employers_and_clean_up_text():
    fair, long = careeronestop.parse_jobs(JOBS)

    assert fair.source == "careeronestop_jobs" and fair.external_id == "abc"
    assert fair.kind is OpportunityKind.JOB
    assert fair.audiences == [Audience.SECOND_CHANCE]
    assert fair.description == "Prep and line work."
    assert fair.posted_at == datetime(2026, 11, 20, 11, 24, 4, tzinfo=UTC)
    # A long title is cut to fit, and a broken link is left out.
    assert long.audiences == [] and len(long.title) == 160 and long.title.endswith("…")
    assert long.apply_url is None


async def test_careeronestop_jobs_page_until_a_short_page():
    paths = []

    def answer(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.raw_path.decode())
        assert request.headers["Authorization"] == "Bearer token-1"
        start = int(request.url.path.split("/")[-3])
        jobs = [{"JvId": f"j{start + i}", "JobTitle": f"Job {start + i}", "Company": "Co"} for i in range(250)]
        return httpx.Response(200, json={"Jobs": jobs if start == 0 else jobs[:10]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as http:
        found = await careeronestop.fetch_jobs(
            http, user_id="user-1", token="token-1", keywords=["0"], location="Milwaukee, WI", radius_miles=25,
            max_age_days=30, limit=1000,
        )

    assert len(found) == 260 and len(paths) == 2
    assert paths[0] == "/v1/jobsearch/user-1/0/Milwaukee%2C%20WI/25/acquisitiondate/DESC/0/250/30"


async def test_careeronestop_errors_carry_no_response_body():
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="secret details")

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as http:
        with pytest.raises(careeronestop.CareerOneStopError) as raised:
            await careeronestop.fetch_training(http, user_id="u", token="t", location="Milwaukee, WI",
                                               radius_miles=25, limit=10)
    assert "401" in str(raised.value) and "secret" not in str(raised.value)


def test_careeronestop_training_programs_are_education_with_the_wioa_note():
    (program,) = careeronestop.parse_training({"SchoolPrograms": [{
        "DetailId": 250859110103, "CipTitle": "Information Technology", "EtaProgramName": "CompTIA Network+",
        "Format": ["In-person", "Online"], "AwardLevel": "Certificate, less than 12 weeks",
        "SchoolName": "Milwaukee Area Technical College", "SchoolURL": "www.matc.edu",
        "Address": "700 W State St", "City": "Milwaukee", "StateAbbr": "WI", "Zip": "53233",
    }]})

    assert program.kind is OpportunityKind.EDUCATION
    assert program.external_id == "250859110103"
    assert program.title == "CompTIA Network+" and program.organization == "Milwaukee Area Technical College"
    assert program.location == "700 W State St, Milwaukee, WI 53233"
    assert program.apply_url == "https://www.matc.edu"
    assert program.description is not None and "In-person, Online" in program.description
    assert "WIOA" in program.description and program.cost is None


# --- CareerOneStop directory downloads --------------------------------------------


def _sheet(header: list[str], *rows: list[object]) -> bytes:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


AJC_HEADER = ["ID", "Name of Center", "Program Type", "Address1", "Address2", "City", "State", "Zip Code", "Phone",
              "Web Site URL", "Have Programs for Ex-Offenders", "Latitiude", "Longitude", "Center Closure Y/N"]


def test_job_centers_keep_open_centers_in_the_area():
    content = _sheet(
        AJC_HEADER,
        [28453, "Job Center Central", "Comprehensive American Job Center", "4201 North 27th Street", "Suite 400",
         "Milwaukee", "WI", "53216", "414-203-8500", "https://www.employmilwaukee.org/", "Yes", 43.0931, -87.9489,
         "N"],
        [1, "Closed Center", "Affiliate American Job Center", "1 Main", None, "Milwaukee", "WI", "53202", None,
         None, "No", None, None, "Y"],
        [2, "Madison Center", "Affiliate American Job Center", "1 Main", None, "Madison", "WI", "53703", None,
         None, "No", None, None, "N"],
        [3, "Chicago Center", "Affiliate American Job Center", "1 Main", None, "Chicago", "IL", "53000", None,
         None, "No", None, None, "N"],
    )

    (center,) = careeronestop.parse_job_centers(content, "WI", ["530", "531", "532"])

    assert center.source == "careeronestop_ajc" and center.external_id == "28453"
    assert center.category is CaseCategory.BRIDGE_TO_EMPLOYMENT
    assert center.address == "4201 North 27th Street, Suite 400, Milwaukee, WI 53216"
    assert (center.latitude, center.longitude) == (43.0931, -87.9489)
    assert center.description is not None and "conviction record" in center.description


def test_reentry_programs_say_who_they_serve():
    content = _sheet(
        ["ID", "State", "Resource", "Description", "WEB Address", "Address_1", "Address_2", "City", "Zip Code",
         "Phone", "Programs for Youth", "Reentry Programs for Youth", "Reentry Programs for Adults"],
        [32801985, "WI", "ATTIC Correctional Services - Milwaukee", "Re-entry services.",
         "https://correctionalservices.org/", "2266 N. Prospect Ave.", "Suite 204", "Milwaukee", 53202,
         "414-277-7933", "N", "Y", "Y"],
    )

    (program,) = careeronestop.parse_reentry_programs(content, "WI", ["532"])

    assert program.name == "ATTIC Correctional Services - Milwaukee"
    assert program.description == ("Re-entry services. Serves adults returning from incarceration, "
                                   "young people returning from incarceration.")
    assert program.website == "https://correctionalservices.org/"


async def test_a_download_follows_the_current_link_on_its_page():
    def answer(request: httpx.Request) -> httpx.Response:
        assert request.headers["User-Agent"] == careeronestop.USER_AGENT
        if request.url.path.endswith(".aspx"):
            return httpx.Response(200, text='<a href="/TridionMultimedia/tcm24-1_XLS_AJC_Data_ACC.xlsx">Download</a>')
        assert request.url.path == "/TridionMultimedia/tcm24-1_XLS_AJC_Data_ACC.xlsx"
        return httpx.Response(200, content=_sheet(AJC_HEADER))

    async with careeronestop.client(5, httpx.MockTransport(answer)) as http:
        assert await careeronestop.fetch_job_centers(http, state="WI", zip_prefixes=["532"]) == []


# --- USAJOBS -----------------------------------------------------------------------

USAJOBS = {"SearchResult": {
    "SearchResultItems": [{"MatchedObjectId": "820345600", "MatchedObjectDescriptor": {
        "PositionTitle": "Medical Support Assistant", "OrganizationName": "Veterans Health Administration",
        "PositionLocationDisplay": "Milwaukee, Wisconsin", "PositionURI": "https://www.usajobs.gov/job/820345600",
        "ApplyURI": ["https://www.usajobs.gov:443/GetJob/ViewDetails/820345600?PostingChannelID="],
        "PositionSchedule": [{"Name": "Full-time", "Code": "1"}],
        "PositionRemuneration": [{"MinimumRange": "41966.0", "MaximumRange": "54557.0", "RateIntervalCode": "PA"}],
        "PublicationStartDate": "2026-11-18T00:00:00.0000", "ApplicationCloseDate": "2026-12-01T23:59:59.9970",
        "UserArea": {"Details": {"JobSummary": "Schedules appointments for veterans."}},
    }}],
    "UserArea": {"NumberOfPages": "1"},
}}


def test_usajobs_rows_carry_pay_schedule_and_closing_date():
    (job,) = usajobs.parse_jobs(USAJOBS)

    assert job.source == "usajobs" and job.external_id == "820345600"
    assert job.pay == "$41,966-$54,557 a year" and job.schedule == "Full-time"
    assert job.apply_url is not None and job.apply_url.startswith("https://www.usajobs.gov:443/GetJob")
    assert job.description == "Schedules appointments for veterans."
    # No offset means Eastern time; 23:59:59.997 EST is 04:59:59.997 UTC.
    assert job.expires_at == datetime(2026, 12, 2, 4, 59, 59, 997000, tzinfo=UTC)


async def test_usajobs_asks_for_public_jobs_near_the_city():
    seen: list[httpx.URL] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        assert request.headers["Authorization-Key"] == "key-1"
        assert request.headers["User-Agent"] == "loader@example.org"
        return httpx.Response(200, json=USAJOBS)

    async with usajobs.client("key-1", "loader@example.org", 5, httpx.MockTransport(answer)) as http:
        found = await usajobs.fetch_jobs(http, location="Milwaukee, WI", radius_miles=25, max_age_days=30, limit=50)

    assert [j.external_id for j in found] == ["820345600"]
    (url,) = seen
    assert url.params["LocationName"] == "Milwaukee, Wisconsin"
    assert url.params["HiringPath"] == "public" and url.params["DatePosted"] == "30"


@pytest.mark.parametrize("value, expected", [
    ("2026-11-20T06:24:04-05:00", datetime(2026, 11, 20, 11, 24, 4, tzinfo=UTC)),
    ("2026-11-20T06:24:04Z", datetime(2026, 11, 20, 6, 24, 4, tzinfo=UTC)),
    ("garbage", None),
    (None, None),
])
def test_dates(value, expected):
    assert parse_datetime(value) == expected


# --- The runner ---------------------------------------------------------------------


def opportunity(source: str, external_id: str, title: str = "Line cook") -> ImportedOpportunity:
    return ImportedOpportunity(source=source, external_id=external_id, kind=OpportunityKind.JOB, title=title,
                               organization="Northside Kitchen", location="Milwaukee, WI")


class Sink:
    def __init__(self, fail_on: str | None = None) -> None:
        self.written: list[tuple[str, str]] = []
        self.retired: list[tuple[str, datetime]] = []
        self.fail_on = fail_on

    async def sync_upsert(self, item, seen_at):
        if item.external_id == self.fail_on:
            raise RuntimeError("constraint")
        assert seen_at == NOW
        self.written.append((item.source, item.external_id))
        return SyncResult.INSERTED

    async def sync_retire(self, source, seen_before):
        self.retired.append((source, seen_before))
        return 2


def source(name: str, items=(), *, error: Exception | None = None, missing: str | None = None,
           target: Target = Target.OPPORTUNITIES) -> Source:
    async def fetch(_):
        if error:
            raise error
        return list(items)

    return Source(name, target, name, lambda _: missing, fetch)


async def test_a_clean_run_writes_every_row_once_and_closes_what_the_source_dropped():
    sink = Sink()
    rows = [opportunity("usajobs", "1"), opportunity("usajobs", "1"), opportunity("usajobs", "2", "Dishwasher")]

    (report,) = await run([source("usajobs", rows)], LoaderConfig(), opportunities=sink, resources=None, now=NOW)

    assert report.status is Status.OK and report.fetched == 3
    assert sink.written == [("usajobs", "1"), ("usajobs", "2")]
    assert report.results == Counter({"inserted": 2}) and report.retired == 2
    assert sink.retired == [("usajobs", NOW)]


async def test_one_source_failing_doesnt_stop_the_others_or_close_its_rows():
    sink = Sink()

    reports = await run(
        [source("usajobs", error=RuntimeError("timed out")), source("careeronestop_jobs", [opportunity("x", "1")])],
        LoaderConfig(), opportunities=sink, resources=None, now=NOW,
    )

    assert [r.status for r in reports] == [Status.FAILED, Status.OK]
    assert "timed out" in reports[0].detail
    assert sink.retired == [("careeronestop_jobs", NOW)]


async def test_nothing_is_closed_after_a_row_fails_or_an_empty_fetch():
    sink = Sink(fail_on="2")

    failed, empty = await run(
        [source("usajobs", [opportunity("usajobs", "1"), opportunity("usajobs", "2", "Dishwasher")]),
         source("careeronestop_jobs", [])],
        LoaderConfig(), opportunities=sink, resources=None, now=NOW,
    )

    assert failed.status is Status.FAILED and failed.errors == 1 and failed.results == Counter({"inserted": 1})
    assert empty.status is Status.OK and "nothing closed" in empty.detail
    assert sink.retired == []


async def test_sources_without_credentials_are_skipped_not_failed():
    (report,) = await run([source("usajobs", missing="needs a key")], LoaderConfig(), opportunities=Sink(),
                          resources=None, now=NOW)
    assert report.status is Status.SKIPPED and report.detail == "needs a key"


async def test_resources_go_to_the_resource_sink():
    opportunities, resources = Sink(), Sink()
    row = ImportedResource(source="careeronestop_ajc", external_id="1", name="Job Center Central",
                           category=CaseCategory.BRIDGE_TO_EMPLOYMENT)

    await run([source("careeronestop_ajc", [row], target=Target.RESOURCES)], LoaderConfig(),
              opportunities=opportunities, resources=resources, now=NOW)

    assert resources.written == [("careeronestop_ajc", "1")] and opportunities.written == []


async def test_a_dry_run_writes_nothing_and_counts_duplicates_across_sources():
    first = source("usajobs", [opportunity("usajobs", "1", "Line Cook")])
    # The same posting from a later source: same title, organization and city.
    second = source("careeronestop_jobs", [
        ImportedOpportunity(source="careeronestop_jobs", external_id="z", kind=OpportunityKind.JOB,
                            title="line cook!", organization="NORTHSIDE KITCHEN", location="Milwaukee, Wisconsin"),
        opportunity("careeronestop_jobs", "y", "Dishwasher"),
    ])

    a, b = await run([first, second], LoaderConfig(), opportunities=None, resources=None, dry_run=True, now=NOW)

    assert a.status is b.status is Status.DRY_RUN
    assert a.results == Counter({"unique": 1}) and b.results == Counter({"unique": 1, "duplicate": 1})


def test_the_fingerprint_ignores_case_punctuation_and_state():
    item = opportunity("a", "1", "Line Cook (PT)")
    assert opportunity_fingerprint(item) == "job|linecookpt|northsidekitchen|milwaukee"
