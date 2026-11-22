"""The staff Insights screen: cases opened in a period (optionally in one
police district), and "Pattern spotted": repeat cases at one block or
intersection, or a neighborhood that doubled. Places come from the worker
(services/place.py); a case it hasn't placed yet counts in the totals but
not toward a district or a pattern."""

from datetime import datetime, timedelta, timezone
from typing import Any

from databridge.insights import InsightsDatabridge
from models.case_enums import CaseCategory
from models.insights import Coverage, Insights, NeedMeasure, Pattern, PatternKind, TractCoverage

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

# Each need, in words, and the ComForce service that answers it (None: all).
NEEDS: dict[NeedMeasure, tuple[str, CaseCategory | None]] = {
    NeedMeasure.HOUSING: ("Housing insecurity", CaseCategory.HOMELESSNESS),
    NeedMeasure.FOOD: ("Food insecurity", CaseCategory.MEAL_PROGRAMS),
    NeedMeasure.TRANSPORTATION: ("No reliable transportation", CaseCategory.TRANSPORTATION),
    NeedMeasure.UTILITIES: ("Utility shut-off threat", CaseCategory.HOMELESSNESS),
    NeedMeasure.FOOD_STAMPS: ("Received food stamps", CaseCategory.MEAL_PROGRAMS),
    NeedMeasure.EMOTIONAL_SUPPORT: ("Lack of social and emotional support", None),
    NeedMeasure.LONELINESS: ("Loneliness", None),
}


def _quantile(values: list[float], q: float) -> float:
    """The value at quantile q (nearest rank) of a non-empty list."""
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))]


def coverage_from(rows: list[dict[str, Any]], measure: NeedMeasure, days: int) -> Coverage:
    """Tracts with the gap flag (need in the top quarter, cases in the
    bottom quarter), the biggest gaps, and a one-line summary."""
    label, category = NEEDS[measure]
    with_need = [r for r in rows if r["need"] is not None]
    need_cut = _quantile([r["need"] for r in with_need], 0.75) if with_need else None
    case_cut = _quantile([float(r["cases"]) for r in with_need], 0.25) if with_need else 0.0
    tracts = [
        TractCoverage(
            tract_geoid=r["tract_geoid"], name=r["name"], latitude=r["latitude"], longitude=r["longitude"],
            need=r["need"], cases=int(r["cases"]), incidents=r["incidents"],
            gap=need_cut is not None and r["need"] is not None and r["need"] >= need_cut and r["cases"] <= case_cut,
        )
        for r in rows
    ]
    gaps = sorted((t for t in tracts if t.gap), key=lambda t: (-(t.need or 0), t.cases))[:5]
    years = [r["need_year"] for r in with_need if r["need_year"]]
    service = f"{NEED_WORDS[category]} cases" if category else "cases"
    if not with_need:
        summary = f"No {label.lower()} data loaded yet (the cdc_places source)."
    elif gaps:
        # Plain words for staff (cognitive-load review, section 6): "areas", not "tracts".
        summary = (f"In the last {days} days, {len([t for t in tracts if t.gap])} areas had high {label.lower()} "
                   f"(at least {need_cut:.0f}% of adults) and little or no ComForce help.")
    else:
        summary = f"Every area with high {label.lower()} had ComForce {service} in the last {days} days."
    return Coverage(measure=measure, measure_label=label, category=category, days=days,
                    need_year=max(years) if years else None, tracts=tracts, gaps=gaps, summary=summary)


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
            delivered_by=await self.insights.delivered_by(start, end, district),
        )

    async def coverage(self, measure: NeedMeasure, days: int, now: datetime | None = None) -> Coverage:
        end = now or datetime.now(timezone.utc)
        _, category = NEEDS[measure]
        rows = await self.insights.coverage(measure.value, category.value if category else None,
                                            end - timedelta(days=days), end)
        return coverage_from(rows, measure, days)
