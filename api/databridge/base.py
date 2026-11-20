from typing import Any, Self

from databridge.executor import FunctionCaller, Row


class Databridge:
    """Base for the per-domain databridges. Each method calls one stored
    function and returns models; no business rules live here.

    A databridge works on whatever `FunctionCaller` it was given: the
    executor (one transaction per call) or, through `within`, a transaction
    another databridge shares."""

    def __init__(self, caller: FunctionCaller) -> None:
        self._caller = caller

    def within(self, transaction: FunctionCaller) -> Self:
        """The same databridge, working inside `transaction`."""
        return type(self)(transaction)

    async def _rows(self, function: str, **params: Any) -> list[Row]:
        return await self._caller.call(function, params)

    async def _first(self, function: str, **params: Any) -> Row | None:
        rows = await self._caller.call(function, params)
        return rows[0] if rows else None

    async def _one(self, function: str, **params: Any) -> Row:
        rows = await self._caller.call(function, params)
        if len(rows) != 1:
            raise RuntimeError(f"app.{function} returned {len(rows)} rows, expected 1")
        return rows[0]
