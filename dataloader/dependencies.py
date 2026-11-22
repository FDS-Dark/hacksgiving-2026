"""The loader's singletons: one database engine (and so one connection pool)
per process, the executor on it, and a databridge per area. Built on first
use, so `--list` and `--dry-run` never connect."""

import logging
from functools import cache
from typing import Any

from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from databridge.executor import PostgresExecutor
from databridge.loader_run import LoaderRunDatabridge
from databridge.opportunity import OpportunityDatabridge
from databridge.public_data import PublicDataDatabridge
from databridge.resource import ResourceDatabridge
from settings import PostgresDatabaseConfig, config

logger = logging.getLogger(__name__)


def database_url(database: PostgresDatabaseConfig) -> URL:
    return URL.create(
        drivername="postgresql+asyncpg", database=database.name, username=database.username,
        password=database.password, host=database.host, port=database.port, query={"ssl": database.ssl},
    )


def create_engine(url: URL, prepared_statements: bool = True) -> AsyncEngine:
    connect_args: dict[str, Any] = {}
    if not prepared_statements:
        # Supabase's transaction pooler can't keep prepared statements
        # between transactions.
        connect_args = {"statement_cache_size": 0, "prepared_statement_cache_size": 0}
    # hide_parameters: errors are logged, and their parameters are source
    # data. The statement itself is a function call and safe to log.
    return create_async_engine(url, pool_pre_ping=True, hide_parameters=True, connect_args=connect_args)


@cache
def get_engine() -> AsyncEngine:
    url = database_url(config.database)
    logger.info("Creating Postgres engine for %s", url.render_as_string(hide_password=True))
    return create_engine(url, config.database.prepared_statements)


@cache
def get_executor() -> PostgresExecutor:
    return PostgresExecutor(get_engine())


@cache
def get_opportunity_databridge() -> OpportunityDatabridge:
    return OpportunityDatabridge(get_executor())


@cache
def get_resource_databridge() -> ResourceDatabridge:
    return ResourceDatabridge(get_executor())


@cache
def get_public_data_databridge() -> PublicDataDatabridge:
    return PublicDataDatabridge(get_executor())


@cache
def get_loader_run_databridge() -> LoaderRunDatabridge:
    return LoaderRunDatabridge(get_executor())


async def dispose() -> None:
    """Closes the connection pool, if one was opened."""
    if get_engine.cache_info().currsize:
        await get_engine().dispose()
