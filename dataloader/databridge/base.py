from typing import Any

from databridge.executor import FunctionCaller, Row


class Databridge:
    """Base for the loader's databridges. Each method calls one stored
    function and returns models; no rules live here."""

    def __init__(self, caller: FunctionCaller) -> None:
        self._caller = caller

    async def _rows(self, function: str, **params: Any) -> list[Row]:
        return await self._caller.call(function, params)

    async def _one(self, function: str, **params: Any) -> Row:
        rows = await self._caller.call(function, params)
        if len(rows) != 1:
            raise RuntimeError(f"app.{function} returned {len(rows)} rows, expected 1")
        return rows[0]
