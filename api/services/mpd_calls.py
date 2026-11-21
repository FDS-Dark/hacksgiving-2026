"""Milwaukee Police Department calls for service: scrape, geocode, store,
summarize.

Ingestion (`MpdCallService.ingest`, run every two minutes by
scripts/ingest_mpd_calls.py) reads the MPD page, parses its one table,
places each call on the map, and upserts by call number. The page lists
calls 30-90 minutes after dispatch and only refreshes every five minutes, so
most runs only update statuses.

Placing a call: about one row in five carries MPD's own estimate,
`LL(-87:56:36.2006,43:04:58.5406): EST 3538 N 24TH PL MKE`. The rest are a
street address or an intersection, which MPD's CAD geocoder resolves; its
answers (and misses) are cached in the database so each address costs one
lookup. Coordinates are rounded to three decimals (~110 m) before they are
stored, and the exact address is never returned by the API, only its block.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from databridge.mpd_call import MpdCallDatabridge
from models.safety import CountItem, MpdCall, MpdCallSummary, MpdCalls

logger = logging.getLogger(__name__)

MILWAUKEE_TZ = ZoneInfo("America/Chicago")
KEEP_DAYS = 30
STALE_AFTER = timedelta(minutes=15)
# New addresses looked up per run; the rest wait for the next run (two
# minutes later). A normal run needs a handful.
MAX_GEOCODES_PER_RUN = 80
GEOCODE_CONCURRENCY = 4
COORDINATE_DECIMALS = 3


class Geocoder(Protocol):
    async def geocode(self, address: str) -> tuple[float, float] | None: ...


class CallsPage(Protocol):
    async def fetch_calls_page(self) -> str: ...


# ── Parsing ──────────────────────────────────────────────────────────────────

_ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
_CELL = re.compile(r"<td\b[^>]*>(.*?)</td>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")
_CALL_NUMBER = re.compile(r"^[A-Z]\d{6,15}$")
_LL = re.compile(r"LL\(\s*(-?[\d:.]+)\s*,\s*(-?[\d:.]+)\s*\)\s*:?\s*(?:EST\s+)?", re.I)
_SPACES = re.compile(r"\s+")

# Street-type words, so a trailing one isn't mistaken for a city code.
_STREET_TYPES = frozenset("""
    AL ALY AV AVE BLVD BL CIR CR CT CTR DR EXPY FWY HWY LN LA PKWY PK PL PLZ RD RDG ROW SQ ST TER TR TRL WAY WY XING
""".split())
_DIRECTIONS = frozenset({"N", "S", "E", "W", "NB", "SB", "EB", "WB"})
IN_PROGRESS = "Service in Progress"


@dataclass(frozen=True, slots=True)
class ParsedCall:
    call_number: str
    dispatched_at: datetime
    location: str  # normalized street text: no LL estimate, place note or city code
    block: str
    district: str
    nature: str
    status: str
    latitude: float | None = None
    longitude: float | None = None

    def row(self) -> dict[str, Any]:
        return {
            "call_number": self.call_number, "dispatched_at": self.dispatched_at, "location": self.location,
            "block": self.block, "district": self.district, "nature": self.nature, "status": self.status,
            "latitude": self.latitude, "longitude": self.longitude,
        }


def _text(fragment: str) -> str:
    return _SPACES.sub(" ", html.unescape(_TAG.sub(" ", fragment))).strip()


def _dms(value: str) -> float | None:
    """'-87:56:36.2006' → -87.943389."""
    parts = value.split(":")
    try:
        numbers = [float(p) for p in parts]
    except ValueError:
        return None
    if not numbers or len(numbers) > 3:
        return None
    degrees, minutes, seconds = (numbers + [0.0, 0.0])[:3]
    sign = -1.0 if value.strip().startswith("-") else 1.0
    return sign * (abs(degrees) + minutes / 60 + seconds / 3600)


def rounded(point: tuple[float, float]) -> tuple[float, float]:
    return round(point[0], COORDINATE_DECIMALS), round(point[1], COORDINATE_DECIMALS)


def split_location(raw: str) -> tuple[str, tuple[float, float] | None]:
    """The street text to geocode and show, and MPD's own estimate when the
    row has one.

    'LL(-87:56:36.2006,43:04:58.5406): EST 3538 N 24TH PL MKE'
        → ('3538 N 24TH PL', (43.082927, -87.943389))
    '2819 W RICHARDSON PL MKE: @NEIGHBORHOOD HOUSE' → ('2819 W RICHARDSON PL', None)
    """
    text = raw.strip().upper()
    point: tuple[float, float] | None = None
    match = _LL.match(text)
    if match:
        lng, lat = _dms(match.group(1)), _dms(match.group(2))
        if lat is not None and lng is not None:
            point = (lat, lng)
        text = text[match.end():]
    # A place or unit note follows ': @' ("@UNIT 6", "@SOLDIERS HOME").
    text = text.split(":", 1)[0].strip()
    words = text.split(" ")
    # The trailing municipality code: MKE, OC (Oak Creek), GF (Greenfield)...
    if len(words) > 1 and words[-1].isalpha() and 2 <= len(words[-1]) <= 4 \
            and words[-1] not in _STREET_TYPES and words[-1] not in _DIRECTIONS:
        words = words[:-1]
    return " ".join(words).strip(), point


def block_of(location: str) -> str:
    """The block or intersection, never the house number.

    '2816 S GREELEY ST' → '2800 block of S GREELEY ST'
    'N 76TH ST/W GOOD HOPE RD' → 'N 76TH ST & W GOOD HOPE RD'
    """
    if "/" in location:
        return " & ".join(part.strip() for part in location.split("/") if part.strip())
    number, _, street = location.partition(" ")
    if number.isdigit() and street:
        return f"{int(number) // 100 * 100} block of {street}"
    return location or "Location withheld"


def _dispatched_at(text: str) -> datetime | None:
    try:
        local = datetime.strptime(text.strip(), "%m/%d/%Y %I:%M %p")
    except ValueError:
        return None
    return local.replace(tzinfo=MILWAUKEE_TZ)


def parse_calls_page(page: str) -> list[ParsedCall]:
    """Every call in the MPD table, one per call number.

    A call appears once per status it went through on the current page
    (e.g. 'City Citation(s) Issued' and 'Service in Progress'); the outcome
    wins over 'Service in Progress'."""
    calls: dict[str, ParsedCall] = {}
    for row in _ROW.findall(page):
        cells = [_text(c) for c in _CELL.findall(row)]
        if len(cells) < 6:
            continue
        number, when, raw_location, district, nature, status = cells[:6]
        number = number.upper()
        dispatched = _dispatched_at(when)
        if not _CALL_NUMBER.match(number) or dispatched is None:
            continue
        location, point = split_location(raw_location)
        parsed = ParsedCall(
            call_number=number, dispatched_at=dispatched, location=location, block=block_of(location),
            district=district or "Unknown", nature=nature or "Unknown", status=status or "Unknown",
            latitude=rounded(point)[0] if point else None, longitude=rounded(point)[1] if point else None,
        )
        seen = calls.get(number)
        if seen is None:
            calls[number] = parsed
        elif seen.status == IN_PROGRESS and parsed.status != IN_PROGRESS:
            calls[number] = replace(parsed, latitude=seen.latitude or parsed.latitude,
                                    longitude=seen.longitude or parsed.longitude)
    return list(calls.values())


# ── Categories ───────────────────────────────────────────────────────────────

# First match wins, so the specific terms come before the general ones.
CATEGORY_TERMS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("weapons", ("weapon", "shots fired", "shotspotter", "shot spotter", "shooting", "stabbing", "armed")),
    ("violent", ("battery", "fight", "assault", "robbery", "homicide", "dead on", "kidnap", "threat",
                 "domestic", "carjack", "hold up", "abuse")),
    ("property", ("theft", "burglary", "entry", "stolen", "damage", "vandal", "arson", "fraud", "shoplift",
                  "trespass", "retail")),
    ("traffic", ("traffic", "reckless", "accident", "crash", "hit and run", "driving", "vehicle", "pursuit",
                 "parking", "motor", "speed")),
    ("disorder", ("noise", "trouble", "suspicious", "disturb", "nuisance", "drug", "loud", "intoxicated",
                  "gambling", "prostitution", "juvenile", "fireworks")),
    ("assist", ("welfare", "emotionally", "resource", "meet", "follow up", "pickup", "return station",
                "community", "assignment", "checking", "investigation", "wanted", "missing", "alarm",
                "escort", "transport", "warrant", "assist")),
)
CATEGORY_ORDER = ("weapons", "violent", "property", "traffic", "disorder", "assist", "other")


def category_of(nature: str) -> str:
    lower = nature.lower()
    for category, terms in CATEGORY_TERMS:
        if any(term in lower for term in terms):
            return category
    return "other"


# ── Summary ──────────────────────────────────────────────────────────────────


def _hour_label(moment: datetime) -> str:
    hour = moment.hour % 12 or 12
    return f"{hour} {'AM' if moment.hour < 12 else 'PM'}"


def summarize(calls: Sequence[MpdCall], hours: int, now: datetime) -> MpdCallSummary:
    by_category = Counter(c.category for c in calls)
    by_nature = Counter(c.nature for c in calls)
    by_district = Counter(c.district for c in calls)

    districts = [str(d) for d in range(1, 8)]
    others = sorted(d for d in by_district if d not in districts)

    # One bucket per local clock hour from the start of the window to now.
    end = now.astimezone(MILWAUKEE_TZ).replace(minute=0, second=0, microsecond=0)
    starts = [end - timedelta(hours=h) for h in range(hours - 1, -1, -1)]
    hourly = Counter(c.dispatched_at.astimezone(MILWAUKEE_TZ).replace(minute=0, second=0, microsecond=0)
                     for c in calls)

    return MpdCallSummary(
        hours=hours,
        total=len(calls),
        mapped=sum(1 for c in calls if c.latitude is not None),
        by_category=[CountItem(label=k, count=by_category[k]) for k in CATEGORY_ORDER if by_category[k]],
        by_nature=[CountItem(label=k, count=v) for k, v in by_nature.most_common(10)],
        by_district=[CountItem(label=d, count=by_district.get(d, 0)) for d in districts]
        + [CountItem(label=d, count=by_district[d]) for d in others],
        by_hour=[CountItem(label=_hour_label(s), count=hourly.get(s, 0)) for s in starts],
    )


def to_api(row: dict[str, Any]) -> MpdCall:
    return MpdCall(
        call_number=row["call_number"], dispatched_at=row["dispatched_at"], block=row["block"],
        district=row["district"], nature=row["nature"], status=row["status"], category=category_of(row["nature"]),
        latitude=row["latitude"], longitude=row["longitude"],
    )


# ── Service ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class IngestResult:
    rows_seen: int
    new_calls: int
    mapped: int
    geocoded: int
    pruned: int


class MpdCallService:
    def __init__(self, calls: MpdCallDatabridge) -> None:
        self.calls = calls

    async def recent(self, hours: int, limit: int = 1000, now: datetime | None = None) -> MpdCalls:
        now = now or datetime.now(timezone.utc)
        rows = await self.calls.recent(hours, limit)
        calls = [to_api(row) for row in rows]
        status = await self.calls.status()
        last_ok = status.get("last_success_at")
        return MpdCalls(
            calls=calls,
            summary=summarize(calls, hours, now),
            last_updated_at=last_ok,
            stale=last_ok is None or now - last_ok > STALE_AFTER,
        )

    async def ingest(self, source: CallsPage, geocoder: Geocoder) -> IngestResult:
        """One scrape. Records the run (ok or not); a failure re-raises."""
        rows_seen = 0
        try:
            parsed = parse_calls_page(await source.fetch_calls_page())
            rows_seen = len(parsed)
            if rows_seen == 0:
                # The table has never been empty at any hour; an empty parse
                # means the page changed shape. Fail loudly rather than
                # silently storing nothing.
                raise ValueError("MPD page parsed to zero calls (layout change?)")
            placed, geocoded = await self._place(parsed, geocoder)
            new_calls = await self.calls.upsert([c.row() for c in placed])
            pruned = await self.calls.prune(KEEP_DAYS)
        except Exception as e:
            await self.calls.record_run(False, rows_seen, 0, f"{type(e).__name__}: {e}")
            raise
        await self.calls.record_run(True, rows_seen, new_calls, None)
        return IngestResult(
            rows_seen=rows_seen, new_calls=new_calls, mapped=sum(1 for c in placed if c.latitude is not None),
            geocoded=geocoded, pruned=pruned,
        )

    async def _place(self, parsed: Iterable[ParsedCall], geocoder: Geocoder) -> tuple[list[ParsedCall], int]:
        calls = list(parsed)
        wanted = sorted({c.location for c in calls if c.latitude is None and c.location})
        known = await self.calls.cached_geocodes(wanted)
        missing = [a for a in wanted if a not in known][:MAX_GEOCODES_PER_RUN]

        gate = asyncio.Semaphore(GEOCODE_CONCURRENCY)

        async def look_up(address: str) -> None:
            async with gate:
                try:
                    point = await geocoder.geocode(address)
                except Exception as e:  # one bad lookup shouldn't sink the run
                    logger.warning("geocode failed for an address: %s", e)
                    return
            point = rounded(point) if point else None
            known[address] = point
            await self.calls.save_geocode(address, point)

        await asyncio.gather(*(look_up(a) for a in missing))

        placed = []
        for call in calls:
            point = known.get(call.location) if call.latitude is None else None
            if point:
                lat, lng = rounded(point)
                call = replace(call, latitude=lat, longitude=lng)
            placed.append(call)
        return placed, len(missing)
