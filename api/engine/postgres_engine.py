import logging
from typing import Any

from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from engine.base_engine import BaseEngine
from settings import PostgresDatabaseConfig, config

logger = logging.getLogger(__name__)


def create_postgres_engine(url: URL, prepared_statements: bool = True) -> AsyncEngine:
    connect_args: dict[str, Any] = {}
    if not prepared_statements:
        # Supabase's transaction pooler can't keep prepared statements
        # between transactions.
        connect_args = {"statement_cache_size": 0, "prepared_statement_cache_size": 0}
    # hide_parameters: database errors are logged, and their parameters are
    # user data. The statement itself is a
    # function call and safe to log.
    return create_async_engine(url, pool_pre_ping=True, hide_parameters=True, connect_args=connect_args)


class PostgresDBEngine(BaseEngine):
    def __init__(self, database: PostgresDatabaseConfig = config.database) -> None:
        self.database = database
        super().__init__()

    def create_engine(self) -> AsyncEngine:
        url = self._make_url()
        logger.info("Creating Postgres engine for %s", url.render_as_string(hide_password=True))
        return create_postgres_engine(url, self.database.prepared_statements)

    def _make_url(self) -> URL:
        cfg = self.database
        return URL.create(
            drivername="postgresql+asyncpg",
            database=cfg.name,
            username=cfg.username,
            password=cfg.password,
            host=cfg.host,
            port=cfg.port,
            query={"ssl": cfg.ssl},
        )
