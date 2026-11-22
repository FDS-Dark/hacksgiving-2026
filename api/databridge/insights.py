"""Insights over cases and their places (0020_case_places.sql)."""

from datetime import datetime
from typing import Any

from databridge.base import Databridge
from models.case import CategoryCount
from models.insights import DeliveredByCount, InsightsDistrict, InsightsTotals


class InsightsDatabridge(Databridge):
    async def districts(self) -> list[InsightsDistrict]:
        return [InsightsDistrict(**row) for row in await self._rows("insights_districts")]

    async def totals(self, start: datetime, end: datetime, district: str | None) -> InsightsTotals:
        return InsightsTotals(**await self._one("insights_totals", start=start, end=end,
                                                district=district))

    async def by_category(self, start: datetime, end: datetime, district: str | None) -> list[CategoryCount]:
        rows = await self._rows("insights_by_category", start=start, end=end, district=district)
        return [CategoryCount(**row) for row in rows]

    async def delivered_by(self, start: datetime, end: datetime, district: str | None) -> list[DeliveredByCount]:
        rows = await self._rows("insights_delivered_by", start=start, end=end, district=district)
        return [DeliveredByCount(**row) for row in rows]

    async def patterns(self, start: datetime, end: datetime, district: str | None, timezone: str,
                       min_cases: int) -> list[dict[str, Any]]:
        """Raw rows: the service words each one."""
        return await self._rows("insights_patterns", start=start, end=end, district=district,
                                timezone=timezone, min_cases=min_cases)

    async def coverage(self, measure_id: str, category: str | None, start: datetime,
                       end: datetime) -> list[dict[str, Any]]:
        return await self._rows("insights_coverage", measure_id=measure_id, category=category, start=start,
                                end=end)
