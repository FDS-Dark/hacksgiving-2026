"""An in-memory stand-in for the stored functions, so service tests check
behaviour (what a caller sees) rather than which SQL was sent.

`FakeFunctions` answers the same function names the databridges call, from
whatever rows a test gives it, and records each call."""

from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from typing import Any

from databridge.executor import FunctionCaller, Row

Handler = Callable[[Mapping[str, Any]], list[Row]]


class FakeFunctions:
    def __init__(self, **handlers: Handler | list[Row]) -> None:
        self.handlers = handlers
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.transactions = 0

    async def call(self, function: str, params: Mapping[str, Any]) -> list[Row]:
        self.calls.append((function, dict(params)))
        handler = self.handlers.get(function)
        if handler is None:
            raise AssertionError(f"unexpected call to app.{function}")
        rows = handler(params) if callable(handler) else handler
        return [dict(row) for row in rows]

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[FunctionCaller]:
        self.transactions += 1
        yield self

    def called(self, function: str) -> list[dict[str, Any]]:
        return [params for name, params in self.calls if name == function]
