"""A worker's own records, for their export (0031_team_chat_and_delivery.sql)."""

from uuid import UUID

from databridge.base import Databridge
from models.export import ExportCase, ExportDebrief, ExportOutcome, ExportTask


class ExportDatabridge(Databridge):
    async def debriefs(self, user_id: UUID) -> list[ExportDebrief]:
        return [ExportDebrief(**row) for row in await self._rows("export_debriefs", user_id=user_id)]

    async def cases(self, user_id: UUID) -> list[ExportCase]:
        return [ExportCase(**row) for row in await self._rows("export_cases", user_id=user_id)]

    async def tasks(self, user_id: UUID) -> list[ExportTask]:
        return [ExportTask(**row) for row in await self._rows("export_tasks", user_id=user_id)]

    async def outcomes(self, user_id: UUID) -> list[ExportOutcome]:
        return [ExportOutcome(**row) for row in await self._rows("export_outcomes", user_id=user_id)]
