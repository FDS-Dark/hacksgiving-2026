"""Runs the database's stored functions (ADR 0007), the same way the API does
(api/databridge/executor.py).

The loader holds no SQL. A databridge asks for a function by name with
named arguments, and the executor turns that into the one statement shape
the loader ever sends:

    SELECT * FROM app.<function>(p_<arg> => :<arg>, ...)

Every value is a bound parameter. Function and argument names are checked
against a strict pattern before they reach the statement, and they always
come from code, never from a source.
"""

import re
from collections.abc import Mapping
from enum import Enum
from typing import Any, Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

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


class PostgresExecutor:
    """Each `call` runs in its own transaction."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def call(self, function: str, params: Mapping[str, Any]) -> list[Row]:
        async with self._engine.begin() as conn:
            result = await conn.execute(text(_statement(function, params)), {k: _bind(v) for k, v in params.items()})
            return [dict(row._mapping) for row in result] if result.returns_rows else []
