"""MCTS (Milwaukee County Transit System) live arrivals for the API, from
the GTFS-Realtime trip updates. (Routes, stops and service alerts are the
data loader's: dataloader/client/mcts.py.)

MCTS developer terms (ridemcts.com/policies/developer-terms): attribute the
data, and say the product isn't sponsored or operated by MTS or MCTS.
"""

from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime

import httpx
from google.transit import gtfs_realtime_pb2

TRIPS_URL = "https://realtime.ridemcts.com/gtfsrt/trips"
USER_AGENT = "hacksgiving-api/1.0"


class MCTSError(RuntimeError):
    """A failed request or an unreadable feed."""


def client(timeout: float, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT}, transport=transport,
                             follow_redirects=True)


async def _bytes(http: httpx.AsyncClient, url: str) -> bytes:
    try:
        response = await http.get(url)
    except httpx.HTTPError as exc:
        raise MCTSError(f"MCTS request failed: {type(exc).__name__}") from None
    if response.status_code != 200:
        raise MCTSError(f"MCTS answered {response.status_code}")
    return response.content


# --- Realtime -------------------------------------------------------------------------


def _feed(content: bytes) -> gtfs_realtime_pb2.FeedMessage:
    message = gtfs_realtime_pb2.FeedMessage()
    try:
        message.ParseFromString(content)
    except Exception:
        raise MCTSError("The realtime feed couldn't be read") from None
    return message


def _when(seconds: int) -> datetime | None:
    return datetime.fromtimestamp(seconds, UTC) if seconds else None


async def fetch_trip_updates(http: httpx.AsyncClient) -> bytes:
    return await _bytes(http, TRIPS_URL)


def arrivals(
    content: bytes, stop_ids: Iterable[str], now: datetime, per_stop: int = 4
) -> dict[str, list[tuple[str, datetime]]]:
    """The next predicted arrivals (route id, time) at each of `stop_ids`."""
    wanted = set(stop_ids)
    found: defaultdict[str, list[tuple[str, datetime]]] = defaultdict(list)
    for entity in _feed(content).entity:
        if not entity.HasField("trip_update"):
            continue
        route = entity.trip_update.trip.route_id
        for update in entity.trip_update.stop_time_update:
            if update.stop_id not in wanted:
                continue
            seconds = update.arrival.time or update.departure.time
            at = _when(seconds)
            if at and at >= now:
                found[update.stop_id].append((route, at))
    return {stop: sorted(times, key=lambda t: t[1])[:per_stop] for stop, times in found.items()}
