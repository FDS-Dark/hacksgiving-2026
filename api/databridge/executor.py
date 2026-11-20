"""Runs the database's stored functions (ADR 0007).

The API holds no SQL. A databridge asks for a function by name with named
arguments, and the executor turns that into the one statement shape the
API ever sends:

    SELECT * FROM app.<function>(p_<arg> => :<arg>, ...)

Every value is a bound parameter. Function and argument names are checked
against a strict pattern before they reach the statement, and they always
come from code, never from a request.
"""

import re
from collections.abc import AsyncIterator, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from enum import Enum
from typing import Any, Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from engine.base_engine import BaseEngine

Row = dict[str, Any]

_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


class FunctionCaller(Protocol):
    """Calls one stored function and returns its rows."""

    async def call(self, function: str, params: Mapping[str, Any]) -> list[Row]: ...


def _statement(function: str, params: Mapping[str, Any]) -> str:
    for name in (function, *params):
        if not _IDENTIFIER.fullmatch(name):
            raise ValueError(f"Not a valid function or argument name: {name!r}")
    arguments = ", ".join(f"p_{name} => :{name}" for name in params)
    return f"SELECT * FROM app.{function}({arguments})"


def _bind(value: Any) -> Any:
    # asyncpg encodes text parameters with str(); an enum member must go as
    # its value.
    return value.value if isinstance(value, Enum) else value


async def _run(conn: AsyncConnection, function: str, params: Mapping[str, Any]) -> list[Row]:
    result = await conn.execute(text(_statement(function, params)), {k: _bind(v) for k, v in params.items()})
    return [dict(row._mapping) for row in result] if result.returns_rows else []


class _ConnectionCaller:
    """Calls functions on one connection, inside its open transaction."""

    def __init__(self, conn: AsyncConnection) -> None:
        self._conn = conn

    async def call(self, function: str, params: Mapping[str, Any]) -> list[Row]:
        return await _run(self._conn, function, params)


class PostgresExecutor:
    """Each `call` runs in its own transaction. Work that must change several
    things atomically runs inside `transaction()`; an exception in the block
    rolls all of it back."""

    def __init__(self, engine: BaseEngine) -> None:
        self._engine = engine

    async def call(self, function: str, params: Mapping[str, Any]) -> list[Row]:
        async with self._engine.engine.begin() as conn:
            return await _run(conn, function, params)

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[FunctionCaller]:
        async with self._engine.engine.begin() as conn:
            yield _ConnectionCaller(conn)

    async def dispose(self) -> None:
        """Closes the connection pool."""
        await self._engine.dispose()


class Transactions(Protocol):
    """Opens a transaction that several databridges can share."""

    def transaction(self) -> AbstractAsyncContextManager[FunctionCaller]: ...
