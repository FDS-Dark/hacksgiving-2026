"""MPD calls-for-service ingestion: parsing the city's page, generalizing
locations, geocoding through the cache, and the summary the app shows."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from databridge.mpd_call import MpdCallDatabridge
from services.mpd_calls import (
    MILWAUKEE_TZ,
    MpdCallService,
    block_of,
    category_of,
    parse_calls_page,
    split_location,
)
from tests.unit.fakes import FakeFunctions

TD = "<td style='border: 1px solid black;'>{}</td>"


def row(*cells: str) -> str:
    return "<tr style='border-style: none;'>" + "".join(TD.format(c) for c in cells) + "</tr>"


IN_PROGRESS = "Service in Progress"
ROWS = [
    ("P2611210938", "11/21/2026 02:30 PM", "2816 S GREELEY ST MKE", "6", "911", IN_PROGRESS),
    ("P2611210939", "11/21/2026 02:30 PM", "646 W COLLEGE AVE OC", "CITY", "Traffic Stop", "City Citation(s) Issued"),
    ("P2611210939", "11/21/2026 02:30 PM", "646 W COLLEGE AVE OC", "CITY", "Traffic Stop", IN_PROGRESS),
    ("P2611210936", "11/21/2026 02:28 PM", "LL(-87:56:36.2006,43:04:58.5406): EST 3538 N 24TH PL MKE", "4",
     "ShotSpotter", IN_PROGRESS),
    ("P2611210930", "11/21/2026 02:20 PM", "N 76TH ST/W GOOD HOPE RD MKE", "4", "Reckless Vehicle", "Advised"),
    ("P2611210931", "11/21/2026 02:21 PM", "4603 N 29TH ST MKE: @UNIT 6", "7", "Battery/Fight/Assault", IN_PROGRESS),
    ("not a call", "x", "y", "z", "w", "v"),
]
PAGE = (
    "<table><thead><tr><th>Call Number</th><th>Date/Time</th><th>Location</th>"
    "<th>Police District</th><th>Nature of Call</th><th>Status</th></tr></thead><tbody>"
    + "\n".join(row(*cells) for cells in ROWS)
    + "</tbody></table>"
)


def test_parses_one_call_per_number_and_keeps_the_outcome():
    calls = {c.call_number: c for c in parse_calls_page(PAGE)}
    assert set(calls) == {"P2611210938", "P2611210939", "P2611210936", "P2611210930", "P2611210931"}
    assert calls["P2611210939"].status == "City Citation(s) Issued"
    assert calls["P2611210938"].dispatched_at == datetime(2026, 11, 21, 14, 30, tzinfo=MILWAUKEE_TZ)
    assert calls["P2611210938"].district == "6"


def test_uses_mpds_estimate_rounded_to_about_110_m():
    shot = next(c for c in parse_calls_page(PAGE) if c.call_number == "P2611210936")
    assert (shot.latitude, shot.longitude) == (43.083, -87.943)
    assert shot.location == "3538 N 24TH PL"
    assert shot.block == "3500 block of N 24TH PL"


@pytest.mark.parametrize(("raw", "location"), [
    ("2816 S GREELEY ST MKE", "2816 S GREELEY ST"),
    ("646 W COLLEGE AVE OC", "646 W COLLEGE AVE"),
    ("4603 N 29TH ST MKE: @UNIT 6", "4603 N 29TH ST"),
    ("2819 W RICHARDSON PL MKE: @NEIGHBORHOOD HOUSE OF MILWAUKEE", "2819 W RICHARDSON PL"),
    ("N 60TH ST/W CAPITOL DR MKE", "N 60TH ST/W CAPITOL DR"),
    ("1200 N PROSPECT AVE", "1200 N PROSPECT AVE"),  # no city code: the street type stays
    ("INT 43 S", "INT 43 S"),
])
def test_normalizes_locations(raw, location):
    assert split_location(raw)[0] == location


@pytest.mark.parametrize(("location", "block"), [
    ("2816 S GREELEY ST", "2800 block of S GREELEY ST"),
    ("46 E MAIN ST", "0 block of E MAIN ST"),
    ("N 76TH ST/W GOOD HOPE RD", "N 76TH ST & W GOOD HOPE RD"),
    ("INT 43 S", "INT 43 S"),
    ("", "Location withheld"),
])
def test_never_shows_the_house_number(location, block):
    assert block_of(location) == block


@pytest.mark.parametrize(("nature", "category"), [
    ("Subject With A Weapon", "weapons"),
    ("ShotSpotter", "weapons"),
    ("Shooting", "weapons"),
    ("Battery/Fight/Assault", "violent"),
    ("Entry-Vehicle", "property"),
    ("Stolen Vehicle", "property"),
    ("Reckless Vehicle", "traffic"),
    ("Traffic Stop", "traffic"),
    ("Noise Nuisance", "disorder"),
    ("Welfare Citizen", "assist"),
    ("911", "other"),
])
def test_groups_call_types(nature, category):
    assert category_of(nature) == category


class FakeGeocoder:
    def __init__(self, answers):
        self.answers = answers
        self.asked: list[str] = []

    async def geocode(self, address):
        self.asked.append(address)
        return self.answers.get(address)


class FakePage:
    def __init__(self, page):
        self.page = page

    async def fetch_calls_page(self):
        return self.page


def service_with(cached=None):
    stored: list[dict] = []

    def upsert(params):
        stored.extend(json.loads(params["calls"]))
        return [{"new_calls": 5}]

    fake = FakeFunctions(
        mpd_geocode_lookup=lambda p: [
            {"address": a, "latitude": v[0] if v else None, "longitude": v[1] if v else None}
            for a, v in (cached or {}).items() if a in p["addresses"]
        ],
        mpd_geocode_save=[],
        mpd_calls_upsert=upsert,
        mpd_calls_prune=[{"deleted": 0}],
        mpd_ingest_record=[],
    )
    return MpdCallService(MpdCallDatabridge(fake)), fake, stored


async def test_ingest_geocodes_only_what_the_cache_lacks():
    service, fake, stored = service_with(cached={"2816 S GREELEY ST": (42.9933, -87.909), "646 W COLLEGE AVE": None})
    geocoder = FakeGeocoder({"N 76TH ST/W GOOD HOPE RD": (43.148728, -88.005387)})

    result = await service.ingest(FakePage(PAGE), geocoder)

    # The cached address and the cached miss aren't asked again; the LL row needs no lookup.
    assert sorted(geocoder.asked) == ["4603 N 29TH ST", "N 76TH ST/W GOOD HOPE RD"]
    saved = {p["address"]: (p["latitude"], p["longitude"]) for p in fake.called("mpd_geocode_save")}
    assert saved == {"N 76TH ST/W GOOD HOPE RD": (43.149, -88.005), "4603 N 29TH ST": (None, None)}

    by_number = {c["call_number"]: c for c in stored}
    assert (by_number["P2611210938"]["latitude"], by_number["P2611210938"]["longitude"]) == (42.993, -87.909)
    assert by_number["P2611210939"]["latitude"] is None
    assert by_number["P2611210930"]["block"] == "N 76TH ST & W GOOD HOPE RD"
    assert (result.rows_seen, result.new_calls, result.mapped, result.geocoded) == (5, 5, 3, 2)
    assert fake.called("mpd_ingest_record") == [{"ok": True, "rows_seen": 5, "new_calls": 5, "error": None}]


async def test_a_page_with_no_calls_is_a_failed_run():
    service, fake, _ = service_with()
    with pytest.raises(ValueError):
        await service.ingest(FakePage("<html>Service unavailable</html>"), FakeGeocoder({}))
    [run] = fake.called("mpd_ingest_record")
    assert run["ok"] is False and "zero calls" in run["error"]
    assert fake.called("mpd_calls_upsert") == []


async def test_recent_summarizes_the_window():
    now = datetime(2026, 11, 21, 21, 10, tzinfo=timezone.utc)  # 3:10 PM in Milwaukee

    def call(number, minutes_ago, nature, district, lat=None):
        return {"call_number": number, "dispatched_at": now - timedelta(minutes=minutes_ago), "block": "x",
                "district": district, "nature": nature, "status": "Advised", "latitude": lat,
                "longitude": -87.9 if lat else None, "location": "secret"}

    rows = [call("P1", 5, "Traffic Stop", "4", 43.0), call("P2", 80, "Traffic Stop", "CITY"),
            call("P3", 75, "Shooting", "4", 43.1)]
    fake = FakeFunctions(
        mpd_calls_recent=rows,
        mpd_ingest_status=[{"last_run_at": now, "last_run_ok": True, "last_success_at": now - timedelta(minutes=3)}],
    )
    result = await MpdCallService(MpdCallDatabridge(fake)).recent(3, now=now)

    assert fake.called("mpd_calls_recent") == [{"hours": 3, "limit": 1000}]
    assert [c.category for c in result.calls] == ["traffic", "traffic", "weapons"]
    assert "location" not in result.calls[0].model_dump()
    s = result.summary
    assert (s.total, s.mapped) == (3, 2)
    assert [(i.label, i.count) for i in s.by_category] == [("weapons", 1), ("traffic", 2)]
    assert s.by_nature[0].label == "Traffic Stop" and s.by_nature[0].count == 2
    assert [(i.label, i.count) for i in s.by_district][3] == ("4", 2)
    assert s.by_district[-1].label == "CITY"
    assert [(i.label, i.count) for i in s.by_hour] == [("1 PM", 2), ("2 PM", 0), ("3 PM", 1)]
    assert result.stale is False


async def test_recent_is_stale_without_a_recent_good_run():
    now = datetime(2026, 11, 21, 21, 10, tzinfo=timezone.utc)
    fake = FakeFunctions(
        mpd_calls_recent=[],
        mpd_ingest_status=[{"last_run_at": now, "last_run_ok": False, "last_success_at": now - timedelta(hours=1)}],
    )
    result = await MpdCallService(MpdCallDatabridge(fake)).recent(6, now=now)
    assert result.stale is True and result.summary.total == 0
    assert len(result.summary.by_hour) == 6
