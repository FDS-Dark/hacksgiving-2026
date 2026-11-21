"""MCTS (Milwaukee County Transit System): the static GTFS feed (routes and
stops, each stop with the routes that serve it), GTFS-Realtime service
alerts for the loader, and live arrivals for the API.

MCTS developer terms (ridemcts.com/policies/developer-terms): attribute the
data, and say the product isn't sponsored or operated by MTS or MCTS.
"""

import csv
import io
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime

import httpx
from google.transit import gtfs_realtime_pb2

from models.public_data import ImportedTransitAlert, ImportedTransitRoute, ImportedTransitStop

SOURCE = "mcts_gtfs"
ALERTS_SOURCE = "mcts_alerts"
STATIC_URL = "https://kamino.mcts.org/gtfs/google_transit.zip"
ALERTS_URL = "https://realtime.ridemcts.com/gtfsrt/alerts"
TRIPS_URL = "https://realtime.ridemcts.com/gtfsrt/trips"
USER_AGENT = "hacksgiving-data-loader/1.0"


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


# --- Static GTFS ----------------------------------------------------------------------


async def fetch_static(http: httpx.AsyncClient) -> list[ImportedTransitRoute | ImportedTransitStop]:
    return parse_static(await _bytes(http, STATIC_URL))


def _csv(feed: zipfile.ZipFile, name: str) -> Iterator[dict[str, str]]:
    with feed.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))


def parse_static(content: bytes) -> list[ImportedTransitRoute | ImportedTransitStop]:
    """Routes, and stops with the routes serving them (from trips and
    stop_times, streamed: stop_times is tens of megabytes)."""
    try:
        feed = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise MCTSError("The GTFS feed isn't a zip file") from None
    with feed:
        routes = [
            ImportedTransitRoute(
                external_id=r["route_id"], short_name=r.get("route_short_name") or None,
                long_name=r.get("route_long_name") or None, color=r.get("route_color") or None,
                text_color=r.get("route_text_color") or None, url=r.get("route_url") or None,
            )
            for r in _csv(feed, "routes.txt") if r.get("route_id")
        ]
        trip_route = {t["trip_id"]: t["route_id"] for t in _csv(feed, "trips.txt")}
        serving: defaultdict[str, set[str]] = defaultdict(set)
        for st in _csv(feed, "stop_times.txt"):
            if route := trip_route.get(st["trip_id"]):
                serving[st["stop_id"]].add(route)
        stops = []
        for s in _csv(feed, "stops.txt"):
            if s.get("location_type") not in (None, "", "0") or not s.get("stop_id"):
                continue
            try:
                latitude, longitude = float(s["stop_lat"]), float(s["stop_lon"])
            except (KeyError, ValueError):
                continue
            stops.append(ImportedTransitStop(
                external_id=s["stop_id"], code=s.get("stop_code") or None, name=s.get("stop_name") or s["stop_id"],
                latitude=latitude, longitude=longitude, routes=sorted(serving.get(s["stop_id"], ())),
            ))
    return [*routes, *stops]


# --- Realtime -------------------------------------------------------------------------


def _feed(content: bytes) -> gtfs_realtime_pb2.FeedMessage:
    message = gtfs_realtime_pb2.FeedMessage()
    try:
        message.ParseFromString(content)
    except Exception:
        raise MCTSError("The realtime feed couldn't be read") from None
    return message


def _english(translated: gtfs_realtime_pb2.TranslatedString) -> str:
    texts = list(translated.translation)
    for t in texts:
        if t.language in ("en", "en-US", ""):
            return str(t.text)
    return str(texts[0].text) if texts else ""


def _when(seconds: int) -> datetime | None:
    return datetime.fromtimestamp(seconds, UTC) if seconds else None


async def fetch_alerts(http: httpx.AsyncClient) -> list[ImportedTransitAlert]:
    return list(parse_alerts(await _bytes(http, ALERTS_URL)))


def parse_alerts(content: bytes) -> Iterator[ImportedTransitAlert]:
    cause_names = gtfs_realtime_pb2.Alert.Cause.Name
    effect_names = gtfs_realtime_pb2.Alert.Effect.Name
    for entity in _feed(content).entity:
        if not entity.HasField("alert"):
            continue
        alert = entity.alert
        header = _english(alert.header_text)
        if not entity.id or not header:
            continue
        period = alert.active_period[0] if alert.active_period else None
        yield ImportedTransitAlert(
            external_id=entity.id,
            header=header,
            description=_english(alert.description_text),
            cause=cause_names(alert.cause) if alert.HasField("cause") else None,
            effect=effect_names(alert.effect) if alert.HasField("effect") else None,
            url=_english(alert.url) or None,
            routes=sorted({e.route_id for e in alert.informed_entity if e.route_id}),
            stops=sorted({e.stop_id for e in alert.informed_entity if e.stop_id}),
            active_from=_when(period.start) if period else None,
            active_until=_when(period.end) if period else None,
        )


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
