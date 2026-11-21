"""Public data the loader keeps current (docs/data-loader.md), served
generalized: incidents at about 1 km, tract counts with small cells
suppressed, dispatch calls labeled as unconfirmed, transit near a place with
live arrivals, weather alerts, community measures and crime trends."""

import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from adapters import mcts
from databridge.public_data import PublicDataDatabridge
from models.public_data import (
    CommunityMeasure,
    CrimeTrendPoint,
    DispatchCall,
    IncidentPoint,
    SourceHealth,
    TractCount,
    TransitArrival,
    TransitNearby,
    WeatherAlert,
)

logger = logging.getLogger(__name__)

# NIBRS offense codes -> the app's map categories (apps/mobile
# src/services/publicSafety.ts), most serious first: a record with several
# codes takes the first that matches.
CATEGORY_CODES: tuple[tuple[str, frozenset[str]], ...] = (
    ("homicide", frozenset({"09A"})),
    ("sex-offense", frozenset({"11A", "11B", "11C", "11D", "36A", "36B"})),
    ("robbery", frozenset({"120"})),
    ("assault", frozenset({"13A", "13B", "13C"})),
    ("arson", frozenset({"200"})),
    ("burglary", frozenset({"220"})),
    ("vehicle-theft", frozenset({"240"})),
    ("vehicle-entry", frozenset({"23F"})),
    ("theft", frozenset({"23A", "23B", "23C", "23D", "23E", "23G", "23H"})),
    ("criminal-damage", frozenset({"290"})),
)
_TRIPS_FRESH_SECONDS = 30


def category_of(codes: list[str]) -> str | None:
    present = set(codes)
    for category, wanted in CATEGORY_CODES:
        if present & wanted:
            return category
    return None


TripFeed = Callable[[], Awaitable[bytes]]


async def _fetch_trips() -> bytes:
    async with mcts.client(10) as http:
        return await mcts.fetch_trip_updates(http)


class PublicDataService:
    def __init__(self, data: PublicDataDatabridge, trips: TripFeed = _fetch_trips) -> None:
        self.data = data
        self._trips = trips
        self._trips_cache: tuple[float, bytes] | None = None

    async def incidents(self, days: int, limit: int) -> list[IncidentPoint]:
        since = datetime.now(UTC) - timedelta(days=days)
        points = await self.data.incident_points(since, limit)
        return [p.model_copy(update={"category": category_of(p.offense_codes)}) for p in points]

    async def tract_counts(self, days: int, offense_code: str | None) -> list[TractCount]:
        return await self.data.tract_counts(datetime.now(UTC) - timedelta(days=days), offense_code)

    async def calls(self, source: str | None, hours: int, limit: int) -> list[DispatchCall]:
        return await self.data.calls(source, datetime.now(UTC) - timedelta(hours=hours), limit)

    async def transit_near(self, latitude: float, longitude: float, radius_m: float, limit: int) -> TransitNearby:
        stops = await self.data.stops_near(latitude, longitude, radius_m, limit)
        routes = sorted({r for s in stops for r in s.routes})
        alerts = await self.data.transit_alerts(routes) if routes else []
        live = False
        if stops:
            feed = await self._trip_feed()
            if feed is not None:
                live = True
                now = datetime.now(UTC)
                try:
                    upcoming = mcts.arrivals(feed, [s.stop_id for s in stops], now)
                except mcts.MCTSError:
                    upcoming, live = {}, False
                stops = [
                    s.model_copy(update={"arrivals": [
                        TransitArrival(route_id=route, route_name=route, arrives_at=at,
                                       minutes=max(0, int((at - now).total_seconds() // 60)))
                        for route, at in upcoming.get(s.stop_id, [])
                    ]})
                    for s in stops
                ]
        return TransitNearby(stops=stops, alerts=alerts, arrivals_live=live)

    async def _trip_feed(self) -> bytes | None:
        """The trip updates feed, at most 30 seconds old; None when MCTS
        can't be reached (the stops still show, without arrivals)."""
        if self._trips_cache and time.monotonic() - self._trips_cache[0] < _TRIPS_FRESH_SECONDS:
            return self._trips_cache[1]
        try:
            feed = await self._trips()
        except Exception as exc:
            logger.warning("MCTS trip updates unavailable: %s", type(exc).__name__)
            return None
        self._trips_cache = (time.monotonic(), feed)
        return feed

    async def weather_alerts(self) -> list[WeatherAlert]:
        return await self.data.weather_alerts()

    async def community_measures(self, tract_geoid: str | None, measure_id: str | None) -> list[CommunityMeasure]:
        return await self.data.community_measures(tract_geoid, measure_id)

    async def crime_trends(self, offense: str | None) -> list[CrimeTrendPoint]:
        return await self.data.crime_trends(offense)

    async def sources(self) -> list[SourceHealth]:
        return await self.data.source_health()
