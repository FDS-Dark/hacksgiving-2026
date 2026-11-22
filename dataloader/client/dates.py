"""Timestamps as the job sources write them."""

import re
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

# Sources without an offset (USAJOBS) mean Eastern time.
_EASTERN = ZoneInfo("America/New_York")
_FRACTION = re.compile(r"\.(\d+)")


def parse_datetime(value: Any) -> datetime | None:
    """An ISO 8601 timestamp, or None when it's missing or unreadable.
    Fractions longer than microseconds are cut ("...59.9970" from USAJOBS),
    and a timestamp without an offset is taken as US Eastern."""
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    text = _FRACTION.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), text, count=1)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_EASTERN)
    return parsed.astimezone(UTC)
