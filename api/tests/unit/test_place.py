"""Placing cases for Insights (services/place.py, adapters/geocoder.py):
what is sent to the locator, and which source wins."""

import json
from typing import Any
from uuid import uuid4

import httpx
import pytest

from adapters.geocoder import GeocodedPoint, GeocoderError, MilwaukeeGeocoder, street_query, tidy_address
from databridge.place import PlaceDatabridge
from databridge.public_data import PublicDataDatabridge
from services.place import CasePlacer, Neighborhoods
from tests.unit.fakes import FakeFunctions


def square(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north],
                                                [west, south]]]}


def area(kind: str, key: str, name: str, west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {"external_id": f"{kind}:{key}", "name": name, "geometry": json.dumps(square(west, south, east, north)),
            "min_lat": south, "min_lon": west, "max_lat": north, "max_lon": east}


# One district, tract and neighborhood around 27th and Center.
AREAS = {
    "police_district": [area("police_district", "3", "3", -88.0, 43.0, -87.9, 43.1)],
    "census_tract": [area("census_tract", "55079004500", "45", -87.96, 43.06, -87.94, 43.08)],
    "neighborhood": [area("neighborhood", "77", "SHERMAN PARK", -87.97, 43.06, -87.94, 43.09)],
}


@pytest.mark.parametrize(("text", "query"), [
    ("27th and Center", "27th and Center"),
    ("near 27th and Center", "27th and Center"),
    ("outside 2716 N 27th St Apt 4", "2700 N 27th St"),
    ("right next to the gas station at Fond du Lac & North", "gas station at Fond du Lac & North"),
    ("2716 N 27th St #3", "2700 N 27th St"),
    ("Sherman Park", None),
    ("by the library", None),
    ("", None),
    (None, None),
])
def test_only_a_block_or_intersection_is_sent(text: str | None, query: str | None):
    assert street_query(text) == query


def test_the_locator_answer_is_tidied_into_a_label():
    assert tidy_address("N 27TH ST & W CENTER ST, Milwaukee, WI, 53210") == "N 27th St & W Center St"
    assert tidy_address("2700 N 27TH ST, MILWAUKEE, WI, 53210") == "2700 N 27th St"


def test_a_neighborhood_is_matched_as_whole_words_longest_first():
    hoods = Neighborhoods([
        {"name": "SHERMAN PARK", "geometry": square(-87.97, 43.06, -87.94, 43.09)},
        {"name": "SHERMAN PARK WEST", "geometry": square(-88.0, 43.06, -87.97, 43.09)},
        {"name": "WALKER'S POINT", "geometry": square(-87.92, 43.02, -87.90, 43.03)},
    ])
    assert hoods.match("we're in sherman park west")[0] == "SHERMAN PARK WEST"  # type: ignore[index]
    assert hoods.match("Walkers Point, by the bridge")[0] == "WALKER'S POINT"  # type: ignore[index]
    assert hoods.match("Shermanpark") is None


class FakeGeocoder:
    def __init__(self, answer: GeocodedPoint | None = None, error: bool = False) -> None:
        self.answer, self.error = answer, error
        self.queries: list[str] = []

    async def locate(self, query: str) -> GeocodedPoint | None:
        self.queries.append(query)
        if self.error:
            raise GeocoderError("down")
        return self.answer


def placer(pending: list[dict[str, Any]], geocoder: FakeGeocoder | None) -> tuple[CasePlacer, FakeFunctions]:
    def saved(params: Any) -> list[dict[str, Any]]:
        return [{"case_id": params["case_id"], "status": params["status"], "source": params["source"],
                 "latitude": params["latitude"], "longitude": params["longitude"], "label": params["label"],
                 "police_district": params["police_district"], "tract_geoid": params["tract_geoid"],
                 "neighborhood": params["neighborhood"]}]

    db = FakeFunctions(case_place_pending=pending, case_place_save=saved,
                       geo_area_list=lambda params: AREAS[params["kind"]])
    return CasePlacer(PlaceDatabridge(db), PublicDataDatabridge(db), geocoder), db


def pending(location: str | None = None, latitude: float | None = None,
            longitude: float | None = None) -> dict[str, Any]:
    return {"case_id": uuid4(), "location": location, "latitude": latitude, "longitude": longitude}


async def test_an_intersection_is_placed_by_the_locator_and_tagged_with_its_areas():
    geocoder = FakeGeocoder(GeocodedPoint(43.068, -87.947, "N 27th St & W Center St"))
    case = pending("near 27th and Center")
    service, db = placer([case], geocoder)

    assert await service.sweep() == 1

    assert geocoder.queries == ["27th and Center"]
    (saved,) = db.called("case_place_save")
    assert (saved["status"], saved["source"], saved["label"]) == ("placed", "geocoder", "N 27th St & W Center St")
    assert (saved["police_district"], saved["tract_geoid"], saved["neighborhood"]) == ("3", "55079004500",
                                                                                       "SHERMAN PARK")
    assert saved["seen_location"] == "near 27th and Center"


async def test_a_cases_own_coordinates_win_and_are_rounded_without_a_lookup():
    geocoder = FakeGeocoder()
    service, db = placer([pending("2716 N 27th St", 43.068123, -87.947456)], geocoder)

    await service.sweep()

    assert geocoder.queries == []
    (saved,) = db.called("case_place_save")
    assert (saved["source"], saved["latitude"], saved["longitude"]) == ("case", 43.068, -87.947)
    assert saved["label"] == "2700 N 27th St"  # never the house number


async def test_a_named_neighborhood_is_placed_at_its_middle():
    service, db = placer([pending("Sherman Park, by the library")], FakeGeocoder())

    await service.sweep()

    (saved,) = db.called("case_place_save")
    assert (saved["source"], saved["label"], saved["neighborhood"]) == ("neighborhood", "Sherman Park",
                                                                        "SHERMAN PARK")
    assert 43.06 <= saved["latitude"] <= 43.09


async def test_nothing_to_go_on_is_unplaced_and_a_failed_lookup_waits_for_next_round():
    nothing, street = pending("by the library"), pending("27th and Center")
    service, db = placer([nothing, street], FakeGeocoder(error=True))

    assert await service.sweep() == 1

    (saved,) = db.called("case_place_save")
    assert (saved["case_id"], saved["status"], saved["latitude"]) == (nothing["case_id"], "unplaced", None)


async def test_lookups_per_round_are_capped():
    geocoder = FakeGeocoder(GeocodedPoint(43.068, -87.947, "N 27th St & W Center St"))
    service, db = placer([pending(f"{n}th and Center") for n in range(20, 35)], geocoder)

    assert await service.sweep() == 10
    assert len(geocoder.queries) == 10


async def test_the_milwaukee_locator_needs_a_confident_answer_inside_the_county():
    def answer(candidates: list[dict[str, Any]]) -> MilwaukeeGeocoder:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"candidates": candidates}))
        return MilwaukeeGeocoder(httpx.AsyncClient(transport=transport))

    good = {"score": 96.9, "address": "N 27TH ST & W CENTER ST, Milwaukee, WI, 53210",
            "location": {"x": -87.94739, "y": 43.06791}}
    assert await answer([good]).locate("27th and Center") == GeocodedPoint(43.068, -87.947,
                                                                           "N 27th St & W Center St")
    assert await answer([{**good, "score": 70}]).locate("27th and Center") is None
    assert await answer([{**good, "location": {"x": -89.4, "y": 43.07}}]).locate("Madison") is None
    assert await answer([]).locate("nowhere") is None

    failing = MilwaukeeGeocoder(httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503))))
    with pytest.raises(GeocoderError):
        await failing.locate("27th and Center")


# --- Wording a pattern (services/insights.py) ------------------------------------


def pattern_row(**overrides: Any) -> dict[str, Any]:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    row = {"kind": "spot", "key": "43.068,-87.947", "label": "N 27th St & W Center St",
           "neighborhood": "SHERMAN PARK", "police_district": "3", "total": 4, "prior_total": 1,
           "top_category": "violence_prevention", "top_category_total": 3, "night_total": 3,
           "weekend_night_total": 3, "first_at": now, "last_at": now, "case_ids": [uuid4()],
           "case_numbers": [1048]}
    return row | overrides


def test_a_spot_pattern_reads_as_a_sentence():
    from services.insights import word_pattern
    pattern = word_pattern(pattern_row(), 30)
    assert pattern.headline == "4 requests near N 27th St & W Center St"
    assert pattern.detail == "3 on weekend nights · mostly violence prevention · up from 1 · Sherman Park"


def test_a_neighborhood_pattern_reads_as_a_sentence():
    from services.insights import word_pattern
    pattern = word_pattern(pattern_row(kind="neighborhood", label="Sherman Park", total=5, prior_total=0,
                                       top_category_total=5, night_total=1, weekend_night_total=0), 7)
    assert pattern.headline == "5 requests in Sherman Park"
    assert pattern.detail == "all violence prevention · none the 7 days before"
