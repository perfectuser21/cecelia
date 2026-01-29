"""Database connection pool for PostgreSQL using asyncpg."""

import os
import logging
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

# Global database instance
_database: Optional["Database"] = None


class Database:
    """Async PostgreSQL database connection pool manager."""

    def __init__(
        self,
        host: str = "localhost",
        port: int = 5432,
        database: str = "cecelia_tasks",
        user: str = "n8n_user",
        password: str = "n8n_password_2025",
        min_size: int = 2,
        max_size: int = 10,
    ):
        """Initialize database configuration.

        Args:
            host: PostgreSQL host
            port: PostgreSQL port
            database: Database name
            user: Database user
            password: Database password
            min_size: Minimum pool size
            max_size: Maximum pool size
        """
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.min_size = min_size
        self.max_size = max_size
        self.pool: Optional[asyncpg.Pool] = None

    @classmethod
    def from_env(cls) -> "Database":
        """Create Database instance from environment variables."""
        return cls(
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", "5432")),
            database=os.getenv("DB_NAME", "cecelia_tasks"),
            user=os.getenv("DB_USER", "n8n_user"),
            password=os.getenv("DB_PASSWORD", "n8n_password_2025"),
            min_size=int(os.getenv("DB_POOL_MIN", "2")),
            max_size=int(os.getenv("DB_POOL_MAX", "10")),
        )

    async def connect(self) -> None:
        """Create the connection pool."""
        if self.pool is not None:
            logger.warning("Database pool already exists")
            return

        logger.info(
            f"Connecting to PostgreSQL: {self.user}@{self.host}:{self.port}/{self.database}"
        )

        self.pool = await asyncpg.create_pool(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            min_size=self.min_size,
            max_size=self.max_size,
        )

        logger.info("Database pool created successfully")

    async def disconnect(self) -> None:
        """Close the connection pool."""
        if self.pool is None:
            logger.warning("Database pool does not exist")
            return

        await self.pool.close()
        self.pool = None
        logger.info("Database pool closed")

    @asynccontextmanager
    async def connection(self):
        """Get a connection from the pool.

        Yields:
            asyncpg.Connection: A database connection

        Raises:
            RuntimeError: If the pool is not initialized
        """
        if self.pool is None:
            raise RuntimeError("Database pool not initialized. Call connect() first.")

        async with self.pool.acquire() as conn:
            yield conn

    async def execute(self, query: str, *args) -> str:
        """Execute a query and return status.

        Args:
            query: SQL query string
            *args: Query parameters

        Returns:
            Command status string
        """
        async with self.connection() as conn:
            return await conn.execute(query, *args)

    async def fetch(self, query: str, *args) -> list:
        """Execute a query and return all rows.

        Args:
            query: SQL query string
            *args: Query parameters

        Returns:
            List of Record objects
        """
        async with self.connection() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args):
        """Execute a query and return first row.

        Args:
            query: SQL query string
            *args: Query parameters

        Returns:
            Record object or None
        """
        async with self.connection() as conn:
            return await conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args):
        """Execute a query and return first value of first row.

        Args:
            query: SQL query string
            *args: Query parameters

        Returns:
            First value or None
        """
        async with self.connection() as conn:
            return await conn.fetchval(query, *args)


def get_database() -> Database:
    """Get or create the global database instance.

    Returns:
        Database: The global database instance
    """
    global _database
    if _database is None:
        _database = Database.from_env()
    return _database


async def init_database() -> Database:
    """Initialize and connect the global database instance.

    Returns:
        Database: The connected database instance
    """
    db = get_database()
    await db.connect()
    return db


async def close_database() -> None:
    """Close the global database instance."""
    global _database
    if _database is not None:
        await _database.disconnect()
        _database = None
