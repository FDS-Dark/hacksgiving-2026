"""The public-data sources without a network or a database: each payload
becomes generalized rows, broken pages fail loudly, and the runner tags,
writes and removes what it should."""

import io
import zipfile
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from google.transit import gtfs_realtime_pb2

from adapters import federal, hunger_task_force, mcts, milwaukee
from loader.geo import AreaIndex, in_geometry
from loader.runner import Status, run
from loader.sources import Source, Target
from models.case_enums import CaseCategory
from models.public_data import (
    ImportedIncident,
    ImportedSignal,
    ImportedTransitRoute,
    ImportedTransitStop,
    ImportedWeatherAlert,
)
from services.public_data import PublicDataService, category_of
from settings import LoaderConfig

NOW = datetime(2026, 11, 21, 18, tzinfo=UTC)
TTL = timedelta(hours=24)


# --- NIBRS ---------------------------------------------------------------------------


def test_incidents_are_generalized_and_future_dates_dropped():
    rows = list(milwaukee.parse_incidents([
        {"Case_Number": "C1", "Incident_Date": "2026-11-20 14:51:00", "Offense_Last_Edited": "2026-11-21 07:35:26",
         "Police_District": "6", "Offense_All": "13A;520", "Address_Longitude": "-87.889381030",
         "Address_Latitude": "42.991791879", "Weapon_Used_All": "HANDGUN; UNKNOWN"},
        # A typo'd year from the source: skipped.
        {"Case_Number": "C2", "Incident_Date": "2027-06-16 14:51:00", "Offense_All": "120"},
        # Coordinates in Lake Michigan: the record stays, unplaced.
        {"Case_Number": "C3", "Incident_Date": "2026-11-19 01:00:00", "Offense_All": "290",
         "Address_Longitude": "-86.5", "Address_Latitude": "43.0"},
        {"Case_Number": "", "Incident_Date": "2026-11-19 01:00:00"},
    ], NOW))

    assert [r.external_id for r in rows] == ["C1", "C3"]
    first = rows[0]
    assert (first.latitude, first.longitude) == (42.992, -87.889)
    assert first.offense_codes == ["13A", "520"] and first.weapons == ["HANDGUN", "UNKNOWN"]
    assert first.incident_at == datetime(2026, 11, 20, 20, 51, tzinfo=UTC)  # 14:51 Central
    assert rows[1].latitude is None


async def test_a_ckan_error_envelope_fails_the_fetch():
    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": False, "error": {"query": ["bad"]}})

    async with milwaukee.client(5, httpx.MockTransport(answer)) as http:
        with pytest.raises(milwaukee.MilwaukeeDataError):
            await milwaukee.fetch_incidents(http, since=NOW - timedelta(days=1), now=NOW, limit=10)


# --- Dispatch calls ------------------------------------------------------------------------


def _page(header: list[str], *rows: list[str]) -> str:
    th = "".join(f"<th>{h}</th>" for h in header)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows)
    return f"<table><thead><tr><th colspan='6'>Refreshed</th></tr><tr>{th}</tr></thead><tbody>{body}</tbody></table>"


def test_mpd_calls_drop_addresses_round_coordinates_and_hide_sensitive_types():
    page = _page(
        milwaukee.MPD_COLUMNS,
        ["P2611211010", "11/21/2026 03:19 PM", "LL(-87:55:28.2217,43:02:39.8038): EST 1012 W HIGHLAND AVE MKE", "1",
         "Shots Fired", "Service in Progress"],
        ["P2611211012", "11/21/2026 03:20 PM", "2709 N TEUTONIA AVE MKE: @UNIT 309", "5", "Domestic Violence",
         "Assigned"],
        ["not-a-call", "11/21/2026 03:20 PM", "x", "5", "Theft", "Assigned"],
    )

    shots, domestic = milwaukee.parse_mpd_calls(page, TTL)

    assert (shots.latitude, shots.longitude) == (43.044, -87.925)
    assert shots.public and shots.district == "1" and shots.expires_at == shots.occurred_at + TTL
    assert "HIGHLAND" not in shots.model_dump_json() and "UNIT" not in domestic.model_dump_json()
    assert domestic.public is False and domestic.latitude is None


@pytest.mark.parametrize(("location", "block"), [
    ("2816 S GREELEY ST MKE", "2800 S GREELEY ST"),
    ("646 W COLLEGE AVE OC", "600 W COLLEGE AVE"),
    ("4603 N 29TH ST MKE: @UNIT 6", "4600 N 29TH ST"),
    ("2819 W RICHARDSON PL MKE: @NEIGHBORHOOD HOUSE OF MILWAUKEE", "2800 W RICHARDSON PL"),
    ("N 76TH ST/W GOOD HOPE RD MKE", "N 76TH ST/W GOOD HOPE RD"),
    ("46 E MAIN ST", "1 E MAIN ST"),
    ("INT 43 S", "INT 43 S"),
    ("", None),
])
def test_mpd_calls_are_geocoded_by_block_never_by_house(location, block):
    assert milwaukee.mpd_block(location) == block


async def test_mpd_calls_without_an_estimate_get_their_blocks_point(monkeypatch):
    monkeypatch.setattr(milwaukee, "_block_points", {})
    page = _page(
        milwaukee.MPD_COLUMNS,
        ["P2611211010", "11/21/2026 03:19 PM", "LL(-87:55:28.2217,43:02:39.8038): EST 1012 W HIGHLAND AVE MKE", "1",
         "Shots Fired", "Service in Progress"],
        ["P2611211011", "11/21/2026 03:19 PM", "2816 S GREELEY ST MKE", "6", "Theft", "Assigned"],
        ["P2611211013", "11/21/2026 03:20 PM", "N 76TH ST/W GOOD HOPE RD MKE", "4", "Traffic Stop", "Advised"],
        ["P2611211012", "11/21/2026 03:20 PM", "2709 N TEUTONIA AVE MKE: @UNIT 309", "5", "Domestic Violence",
         "Assigned"],
    )
    asked: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.host == "itmdapps.milwaukee.gov":
            return httpx.Response(200, text=page)
        single = request.url.params["SingleLine"]
        asked.append(single)
        if single == "2800 S GREELEY ST":
            return httpx.Response(200, json={"candidates": [
                {"score": 100, "location": {"x": -87.909248, "y": 42.99369}}]})
        return httpx.Response(200, json={"candidates": []})

    async with milwaukee.client(5, httpx.MockTransport(answer)) as http:
        shots, theft, stop, domestic = await milwaukee.fetch_mpd_calls(http, ttl=TTL)
        again = await milwaukee.fetch_mpd_calls(http, ttl=TTL)

    # Only blocks and intersections are asked about, each once; the estimate and the sensitive call aren't.
    assert sorted(asked) == ["2800 S GREELEY ST", "N 76TH ST/W GOOD HOPE RD"]
    assert (shots.latitude, shots.longitude) == (43.044, -87.925)
    assert (theft.latitude, theft.longitude) == (42.994, -87.909)
    assert stop.latitude is None  # no answer: unplaced, not guessed
    assert domestic.latitude is None and domestic.public is False
    assert (again[1].latitude, again[1].longitude) == (42.994, -87.909)
    assert "GREELEY" not in theft.model_dump_json()


async def test_a_geocoder_outage_leaves_calls_unplaced_without_failing(monkeypatch):
    monkeypatch.setattr(milwaukee, "_block_points", {})
    page = _page(milwaukee.MPD_COLUMNS, ["P2611211011", "11/21/2026 03:19 PM", "2816 S GREELEY ST MKE", "6", "Theft",
                                         "Assigned"])

    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=page) if request.url.host == "itmdapps.milwaukee.gov" else httpx.Response(503)

    async with milwaukee.client(5, httpx.MockTransport(answer)) as http:
        [theft] = await milwaukee.fetch_mpd_calls(http, ttl=TTL)
    assert theft.latitude is None
    assert "2800 S GREELEY ST" not in milwaukee._block_points  # retried next run, not cached as a miss


def test_mpd_rate_limiting_and_a_changed_page_fail_loudly():
    limited = _page(milwaukee.MPD_COLUMNS, ["17952987", "11/21/2026 04:05 PM", "", "-1",
                                            "Unreasonable amount of requests", ""])
    with pytest.raises(milwaukee.MilwaukeeDataError, match="rate limiting"):
        list(milwaukee.parse_mpd_calls(limited, TTL))

    reordered = _page(["Date/Time", "Call Number", "Location", "Police District", "Nature of Call", "Status"])
    with pytest.raises(milwaukee.MilwaukeeDataError, match="no longer has the columns"):
        list(milwaukee.parse_mpd_calls(reordered, TTL))


def test_mfd_calls_keep_the_city_not_the_address():
    page = _page(milwaukee.MFD_COLUMNS, ["F2611210257", "2026-11-21 15:25:22", "8236 W VILLARD AVE MKE: @UNIT 1",
                                         "MKE", "EMS", "CLOSED"])
    (call,) = milwaukee.parse_mfd_calls(page, TTL)
    assert call.external_id == "F2611210257" and call.city == "MKE" and call.status == "CLOSED"
    assert "VILLARD" not in call.model_dump_json()


# --- Boundaries and point in polygon ------------------------------------------------------

SQUARE = {"type": "Polygon", "coordinates": [
    [[-88.0, 43.0], [-87.9, 43.0], [-87.9, 43.1], [-88.0, 43.1], [-88.0, 43.0]],
    # A hole in the middle.
    [[-87.96, 43.04], [-87.94, 43.04], [-87.94, 43.06], [-87.96, 43.06], [-87.96, 43.04]],
]}


def test_boundaries_carry_bounding_boxes_and_arcgis_errors_fail():
    (area,) = milwaukee.parse_boundaries(
        {"features": [{"geometry": SQUARE, "properties": {"GEOID": "55079000100", "NAME": "1", "OBJECTID": 9}}]},
        "census_tract", "GEOID", "NAME")
    assert area.external_id == "census_tract:55079000100" and area.name == "1"
    assert (area.min_lat, area.max_lat, area.min_lon, area.max_lon) == (43.0, 43.1, -88.0, -87.9)
    assert "OBJECTID" not in area.properties

    with pytest.raises(milwaukee.MilwaukeeDataError, match="error"):
        list(milwaukee.parse_boundaries({"error": {"code": 400}}, "census_tract", "GEOID", "NAME"))
    with pytest.raises(milwaukee.MilwaukeeDataError, match="truncated"):
        list(milwaukee.parse_boundaries({"features": [], "exceededTransferLimit": True}, "x", "a", "b"))


def test_point_in_polygon_respects_holes():
    assert in_geometry(-87.99, 43.01, SQUARE)
    assert not in_geometry(-87.95, 43.05, SQUARE)  # in the hole
    assert not in_geometry(-87.8, 43.05, SQUARE)
    index = AreaIndex.from_rows([{"external_id": "census_tract:55079000100", "min_lat": 43.0, "min_lon": -88.0,
                                  "max_lat": 43.1, "max_lon": -87.9, "geometry": SQUARE}])
    assert index.find(43.01, -87.99) == "55079000100" and index.find(None, None) is None


# --- MCTS ----------------------------------------------------------------------------------


def _gtfs() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as feed:
        feed.writestr("routes.txt", "route_id,route_short_name,route_long_name,route_color\n"
                                    "30,30,Sherman-Wisconsin,008556\n")
        feed.writestr("trips.txt", "route_id,trip_id\n30,t1\n")
        feed.writestr("stop_times.txt", "trip_id,stop_id,stop_sequence\nt1,66,1\n")
        feed.writestr("stops.txt", "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type\n"
                                   "66,66,WISCONSIN & JACKSON,43.0387653,-87.9048367,0\n"
                                   "999,,A STATION,43.0,-87.9,1\n")
    return out.getvalue()


def test_gtfs_stops_list_the_routes_serving_them():
    route, stop = mcts.parse_static(_gtfs())
    assert isinstance(route, ImportedTransitRoute) and isinstance(stop, ImportedTransitStop)
    assert route.external_id == "30" and route.color == "008556"
    assert stop.external_id == "66" and stop.routes == ["30"]


def _alerts_feed() -> bytes:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    entity = feed.entity.add()
    entity.id = "detour-1"
    entity.alert.header_text.translation.add(text="60 Detour", language="en")
    entity.alert.description_text.translation.add(text="Stops closed", language="en")
    entity.alert.effect = gtfs_realtime_pb2.Alert.DETOUR
    entity.alert.informed_entity.add(route_id="60")
    entity.alert.active_period.add(start=int(NOW.timestamp()))
    trip = feed.entity.add()
    trip.id = "t"
    trip.trip_update.trip.route_id = "30"
    update = trip.trip_update.stop_time_update.add(stop_id="66")
    update.arrival.time = int((NOW + timedelta(minutes=5)).timestamp())
    gone = trip.trip_update.stop_time_update.add(stop_id="66")
    gone.arrival.time = int((NOW - timedelta(minutes=5)).timestamp())
    return feed.SerializeToString()


def test_realtime_alerts_and_arrivals():
    (alert,) = mcts.parse_alerts(_alerts_feed())
    assert alert.header == "60 Detour" and alert.effect == "DETOUR" and alert.routes == ["60"]
    assert alert.active_from == NOW and alert.active_until is None
    assert mcts.arrivals(_alerts_feed(), ["66"], NOW) == {"66": [("30", NOW + timedelta(minutes=5))]}


# --- Federal sources ------------------------------------------------------------------------


def test_weather_alerts():
    (alert,) = federal.parse_weather_alerts({"features": [{"properties": {
        "id": "urn:oid:1", "event": "Winter Storm Warning", "severity": "Severe", "areaDesc": "Milwaukee",
        "effective": "2026-11-21T12:00:00-06:00", "ends": "2026-11-22T12:00:00-06:00", "description": "Snow."}}]})
    assert alert.event == "Winter Storm Warning" and alert.expires_at == datetime(2026, 11, 22, 18, tzinfo=UTC)


def test_cdc_measures_and_fbi_trends():
    (measure,) = federal.parse_community_measures([
        {"locationname": "55079090700", "measure": "Housing insecurity", "measureid": "HOUSINSECU",
         "data_value": "5.4", "totalpopulation": "3021", "year": "2023"},
        {"locationname": "55079090700", "measureid": "X", "year": "n/a"},
    ])
    assert measure.external_id == "55079090700|HOUSINSECU|2023" and measure.value == 5.4 and measure.population == 3021

    trends = list(federal.parse_crime_trends({
        "offenses": {"actuals": {"Milwaukee Police Department Offenses": {"01-2025": 540}},
                     "rates": {"Wisconsin Offenses": {"01-2025": 20.36, "bad": 1}}},
        "cde_properties": {"last_refresh_date": {"UCR": "11/15/2026"}},
    }, "violent-crime"))
    assert [(t.measure, t.series, t.month, t.value) for t in trends] == [
        ("actual", "Milwaukee Police Department Offenses", date(2025, 1, 1), 540.0),
        ("rate", "Wisconsin Offenses", date(2025, 1, 1), 20.36),
    ]
    assert trends[0].source_refreshed_at == datetime(2026, 11, 15, tzinfo=UTC)


# --- Hunger Task Force -----------------------------------------------------------------------

KML = b"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Food Pantries</name>
  <Placemark><name>All Saints Food Pantry</name>
    <ExtendedData>
      <Data name="Program"><value>Food Pantry
CSFP / Stockbox</value></Data>
      <Data name="Address"><value>4060 N 26th Street</value></Data>
      <Data name="Zip Code"><value>53209</value></Data>
      <Data name="Operation Days"><value>Tuesdays and Thursdays</value></Data>
      <Data name="Operation Time"><value>9:30AM - 12:00PM</value></Data>
      <Data name="Who is eligible"><value>Anyone in the service area</value></Data>
    </ExtendedData></Placemark>
  <Placemark><name>Lakeside Meals</name>
    <ExtendedData><Data name="Address"><value>1 E Main St</value></Data>
      <Data name="Zip Code"><value>53202</value></Data></ExtendedData>
    <Point><coordinates>-87.9,43.04,0</coordinates></Point></Placemark>
</Folder></Document></kml>"""


async def test_food_sites_are_meal_programs_placed_by_the_census_geocoder():
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.google.com":
            return httpx.Response(200, content=KML)
        assert b"4060 N 26th Street" in request.content and b"1 E Main St" not in request.content
        return httpx.Response(200, text='"0","4060 N 26th Street, Milwaukee, WI, 53209","Match","Exact",'
                                        '"4060 N 26TH ST","-87.945624,43.091056","1","R"\n')

    async with hunger_task_force.client(5, httpx.MockTransport(answer)) as http:
        pantry, meals = await hunger_task_force.fetch_sites(http)

    assert pantry.category is CaseCategory.MEAL_PROGRAMS and pantry.name == "All Saints Food Pantry"
    assert (pantry.latitude, pantry.longitude) == (43.091056, -87.945624)
    assert pantry.hours == "Tuesdays and Thursdays · 9:30AM - 12:00PM"
    assert pantry.address == "4060 N 26th Street, Milwaukee, WI 53209"
    assert pantry.description is not None and "Who can come: Anyone in the service area" in pantry.description
    assert (meals.latitude, meals.longitude) == (43.04, -87.9)


# --- The runner and the API service ------------------------------------------------------------


class PublicSink:
    def __init__(self) -> None:
        self.synced: list[tuple[str, list]] = []
        self.retired: list[tuple[str, str, datetime | None]] = []

    async def sync(self, source, rows, seen_at):
        self.synced.append((source, list(rows)))
        return len(rows), len(rows)

    async def retire(self, table, source, seen_before, window_start=None):
        self.retired.append((table, source, window_start))
        return 1

    async def areas(self, kind):
        assert kind == "census_tract"
        return [{"external_id": "census_tract:55079000100", "min_lat": 43.0, "min_lon": -88.0, "max_lat": 43.1,
                 "max_lon": -87.9, "geometry": SQUARE}]


class Runs:
    def __init__(self) -> None:
        self.recorded: list[dict] = []

    async def record_run(self, **run):
        self.recorded.append(run)


def bulk(name, items, target=Target.INCIDENTS, tables=("external_incidents",), empty_is_valid=False):
    async def fetch(_):
        return list(items)

    return Source(name, target, name, lambda _: None, fetch, tables=tables, empty_is_valid=empty_is_valid)


async def test_incidents_are_tagged_with_their_tract_and_retired_within_the_window():
    sink, runs = PublicSink(), Runs()
    rows = [ImportedIncident(external_id="C1", incident_at=NOW, latitude=43.01, longitude=-87.99),
            ImportedIncident(external_id="C2", incident_at=NOW)]

    (report,) = await run([bulk("mke_nibrs", rows)], LoaderConfig(nibrs_window_days=90), opportunities=None,
                          resources=None, public_data=sink, runs=runs, now=NOW)

    (_, written), = sink.synced
    assert [r.tract_geoid for r in written] == ["55079000100", None]
    assert sink.retired == [("external_incidents", "mke_nibrs", NOW - timedelta(days=90))]
    assert report.status is Status.OK and report.retired == 1
    assert runs.recorded[0]["source"] == "mke_nibrs" and runs.recorded[0]["written"] == 2


async def test_an_empty_alert_feed_clears_alerts_but_an_empty_directory_removes_nothing():
    sink = PublicSink()
    await run([bulk("nws_alerts", [], Target.WEATHER, ("weather_alerts",), empty_is_valid=True),
               bulk("cdc_places", [], Target.COMMUNITY, ("community_measures",))],
              LoaderConfig(), opportunities=None, resources=None, public_data=sink, now=NOW)
    assert [t for t, _, _ in sink.retired] == ["weather_alerts"]


async def test_failures_and_skips_are_logged_as_runs():
    runs = Runs()

    async def broken(_):
        raise milwaukee.MilwaukeeDataError("rate limited")

    sources = [Source("mpd_calls", Target.SIGNALS, "x", lambda _: None, broken),
               Source("fbi_cde", Target.CRIME, "x", lambda _: "needs a key", broken)]
    reports = await run(sources, LoaderConfig(), opportunities=None, resources=None, public_data=PublicSink(),
                        runs=runs, now=NOW)

    assert [r.status for r in reports] == [Status.FAILED, Status.SKIPPED]
    assert [(r["status"], r["detail"]) for r in runs.recorded] == [
        ("failed", "fetch failed: rate limited"), ("skipped", "needs a key")]


def test_signals_and_weather_rows_serialize_for_the_bulk_functions():
    signal = ImportedSignal(external_id="P1", occurred_at=NOW, category="Shots Fired", public=True,
                            expires_at=NOW + TTL)
    assert signal.row()["occurred_at"] == "2026-11-21T18:00:00Z"
    assert ImportedWeatherAlert(external_id="a", event="Heat Advisory").row()["description"] == ""


@pytest.mark.parametrize("codes, category", [
    (["13A", "09A"], "homicide"), (["23F"], "vehicle-entry"), (["23C"], "theft"), (["520"], None),
])
def test_nibrs_codes_map_to_the_apps_categories(codes, category):
    assert category_of(codes) == category


async def test_transit_arrivals_are_cached_and_optional():
    from models.public_data import TransitStop

    calls = 0

    class Data:
        async def stops_near(self, *_):
            return [TransitStop(stop_id="66", name="WISCONSIN & JACKSON", latitude=43.03, longitude=-87.9,
                                distance_m=136, routes=["30"], route_names=["30"])]

        async def transit_alerts(self, routes):
            assert routes == ["30"]
            return []

    async def trips():
        nonlocal calls
        calls += 1
        if calls > 1:
            raise AssertionError("should have used the cache")
        return _alerts_feed()

    service = PublicDataService(Data(), trips)  # type: ignore[arg-type]
    first = await service.transit_near(43.03, -87.9, 500, 3)
    await service.transit_near(43.03, -87.9, 500, 3)
    assert first.arrivals_live and calls == 1

    async def down():
        raise httpx.ConnectError("no network")

    offline = await PublicDataService(Data(), down).transit_near(43.03, -87.9, 500, 3)  # type: ignore[arg-type]
    assert offline.arrivals_live is False and offline.stops[0].arrivals == []
