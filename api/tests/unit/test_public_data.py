"""The public-data service without a database: NIBRS codes map to the app's
map categories, and transit arrivals come from MCTS's realtime feed, cached
and optional. (The loader that fills these tables is dataloader/.)"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from google.transit import gtfs_realtime_pb2

from adapters import mcts
from services.public_data import PublicDataService, category_of

NOW = datetime(2026, 11, 21, 18, tzinfo=UTC)


def _trips_feed() -> bytes:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    trip = feed.entity.add()
    trip.id = "t"
    trip.trip_update.trip.route_id = "30"
    update = trip.trip_update.stop_time_update.add(stop_id="66")
    update.arrival.time = int((NOW + timedelta(minutes=5)).timestamp())
    gone = trip.trip_update.stop_time_update.add(stop_id="66")
    gone.arrival.time = int((NOW - timedelta(minutes=5)).timestamp())
    return feed.SerializeToString()


def test_arrivals_are_the_next_predicted_ones_at_each_stop():
    assert mcts.arrivals(_trips_feed(), ["66"], NOW) == {"66": [("30", NOW + timedelta(minutes=5))]}
    assert mcts.arrivals(_trips_feed(), ["67"], NOW) == {}


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
        return _trips_feed()

    service = PublicDataService(Data(), trips)  # type: ignore[arg-type]
    first = await service.transit_near(43.03, -87.9, 500, 3)
    await service.transit_near(43.03, -87.9, 500, 3)
    assert first.arrivals_live and calls == 1

    async def down():
        raise httpx.ConnectError("no network")

    offline = await PublicDataService(Data(), down).transit_near(43.03, -87.9, 500, 3)  # type: ignore[arg-type]
    assert offline.arrivals_live is False and offline.stops[0].arrivals == []
