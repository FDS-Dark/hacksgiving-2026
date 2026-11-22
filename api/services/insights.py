"""The staff Insights screen: cases opened in a period (optionally in one
police district), and "Pattern spotted": repeat cases at one block or
intersection, or a neighborhood that doubled. Places come from the worker
(services/place.py); a case it hasn't placed yet counts in the totals but
not toward a district or a pattern."""

from datetime import datetime, timedelta, timezone
from typing import Any

from databridge.insights import InsightsDatabridge
from models.case_enums import CaseCategory
from models.insights import Insights, Pattern, PatternKind

# How a need reads in a sentence: "mostly housing".
NEED_WORDS: dict[CaseCategory, str] = {
    CaseCategory.HOMELESSNESS: "housing and shelter",
    CaseCategory.MISSING_PERSONS: "missing persons",
    CaseCategory.MEAL_PROGRAMS: "food",
    CaseCategory.VIOLENCE_PREVENTION: "violence prevention",
    CaseCategory.TRANSPORTATION: "rides",
    CaseCategory.INCIDENT_DEESCALATION: "de-escalation",
    CaseCategory.BURIAL_ASSISTANCE: "burial help",
    CaseCategory.BRIDGE_TO_EMPLOYMENT: "jobs",
    CaseCategory.OTHER: "other needs",
}
MIN_CASES = 3


def _title(name: str | None) -> str | None:
    return " ".join(w[:1].upper() + w[1:].lower() for w in name.split(" ")) if name else None


def word_pattern(row: dict[str, Any], days: int) -> Pattern:
    """A pattern row in words: '4 requests near N 27th St & W Center St' /
    '3 on weekend nights · mostly violence prevention · up from 1'."""
    kind = PatternKind(row["kind"])
    total, prior = int(row["total"]), int(row["prior_total"])
    category = CaseCategory(row["top_category"]) if row["top_category"] else None
    neighborhood = _title(row["neighborhood"])
    label = row["label"] or neighborhood or "one place"
    if kind == PatternKind.SPOT:
        headline = f"{total} requests near {label}"
    else:
        headline = f"{total} requests in {neighborhood or label}"

    parts: list[str] = []
    weekend, night = int(row["weekend_night_total"]), int(row["night_total"])
    if weekend >= 2 and weekend * 2 >= total:
        parts.append(f"{weekend} on weekend nights")
    elif night >= 2 and night * 2 >= total:
        parts.append(f"{night} at night")
    top = int(row["top_category_total"])
    if category is not None and top * 2 > total:
        parts.append("all " + NEED_WORDS[category] if top == total else "mostly " + NEED_WORDS[category])
    if prior == 0:
        parts.append(f"none the {days} days before")
    elif prior < total:
        parts.append(f"up from {prior}")
    if kind == PatternKind.SPOT and neighborhood and neighborhood != label:
        parts.append(neighborhood)

    return Pattern(
        kind=kind, label=label, neighborhood=neighborhood, police_district=row["police_district"],
        total=total, prior_total=prior, top_category=category, top_category_total=top,
        night_total=night, weekend_night_total=weekend, first_at=row["first_at"], last_at=row["last_at"],
        case_ids=list(row["case_ids"] or []), case_numbers=[int(n) for n in row["case_numbers"] or []],
        headline=headline, detail=" · ".join(parts),
    )


class InsightsService:
    def __init__(self, insights: InsightsDatabridge, tz: str) -> None:
        self.insights = insights
        self.tz = tz

    async def overview(self, days: int, district: str | None, now: datetime | None = None) -> Insights:
        end = now or datetime.now(timezone.utc)
        start = end - timedelta(days=days)
        rows = await self.insights.patterns(start, end, district, self.tz, MIN_CASES)
        return Insights(
            period_start=start, period_end=end, days=days, district=district,
            districts=await self.insights.districts(),
            totals=await self.insights.totals(start, end, district),
            by_category=await self.insights.by_category(start, end, district),
            patterns=[word_pattern(row, days) for row in rows],
        )
