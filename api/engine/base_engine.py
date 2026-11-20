from abc import ABC, abstractmethod

from sqlalchemy.engine.url import URL
from sqlalchemy.ext.asyncio import AsyncEngine


class BaseEngine(ABC):
    """Owns one SQLAlchemy async engine (and so its connection pool)."""

    def __init__(self) -> None:
        self.engine: AsyncEngine = self.create_engine()

    @abstractmethod
    def create_engine(self) -> AsyncEngine:
        """Create the database engine."""

    @abstractmethod
    def _make_url(self) -> URL:
        """Create the database connection URL."""

    async def dispose(self) -> None:
        await self.engine.dispose()
