"""Tests for database connection pool."""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.db.pool import Database, get_database, init_database, close_database


class TestDatabaseInit:
    """Tests for Database initialization."""

    def test_database_init_with_defaults(self):
        """Database should initialize with default values."""
        db = Database()
        assert db.host == "localhost"
        assert db.port == 5432
        assert db.database == "cecelia_tasks"
        assert db.user == "n8n_user"
        assert db.password == "n8n_password_2025"
        assert db.min_size == 2
        assert db.max_size == 10
        assert db.pool is None

    def test_database_init_with_custom_values(self):
        """Database should accept custom configuration."""
        db = Database(
            host="custom-host",
            port=5433,
            database="custom_db",
            user="custom_user",
            password="custom_pass",
            min_size=5,
            max_size=20,
        )
        assert db.host == "custom-host"
        assert db.port == 5433
        assert db.database == "custom_db"
        assert db.user == "custom_user"
        assert db.password == "custom_pass"
        assert db.min_size == 5
        assert db.max_size == 20

    def test_database_from_env(self):
        """Database.from_env should read from environment variables."""
        with patch.dict(
            os.environ,
            {
                "DB_HOST": "env-host",
                "DB_PORT": "5434",
                "DB_NAME": "env_db",
                "DB_USER": "env_user",
                "DB_PASSWORD": "env_pass",
                "DB_POOL_MIN": "3",
                "DB_POOL_MAX": "15",
            },
        ):
            db = Database.from_env()
            assert db.host == "env-host"
            assert db.port == 5434
            assert db.database == "env_db"
            assert db.user == "env_user"
            assert db.password == "env_pass"
            assert db.min_size == 3
            assert db.max_size == 15


class TestDatabaseConnection:
    """Tests for Database connection management."""

    @pytest.mark.asyncio
    async def test_connect_creates_pool(self):
        """connect() should create a connection pool."""
        db = Database()

        mock_pool = MagicMock()

        async def mock_create_pool(**kwargs):
            return mock_pool

        with patch("src.db.pool.asyncpg.create_pool", side_effect=mock_create_pool) as mock_create:
            await db.connect()

            mock_create.assert_called_once_with(
                host="localhost",
                port=5432,
                database="cecelia_tasks",
                user="n8n_user",
                password="n8n_password_2025",
                min_size=2,
                max_size=10,
            )
            assert db.pool == mock_pool

    @pytest.mark.asyncio
    async def test_connect_when_pool_exists(self):
        """connect() should warn if pool already exists."""
        db = Database()
        db.pool = MagicMock()

        with patch("src.db.pool.asyncpg.create_pool") as mock_create:
            await db.connect()
            mock_create.assert_not_called()

    @pytest.mark.asyncio
    async def test_disconnect_closes_pool(self):
        """disconnect() should close the connection pool."""
        db = Database()
        mock_pool = AsyncMock()
        db.pool = mock_pool

        await db.disconnect()

        mock_pool.close.assert_called_once()
        assert db.pool is None

    @pytest.mark.asyncio
    async def test_disconnect_when_no_pool(self):
        """disconnect() should handle no pool gracefully."""
        db = Database()
        db.pool = None

        # Should not raise
        await db.disconnect()
        assert db.pool is None


class TestDatabaseOperations:
    """Tests for Database query operations."""

    @pytest.fixture
    def db_with_pool(self):
        """Database with a mocked pool."""
        db = Database()
        mock_pool = MagicMock()
        mock_conn = AsyncMock()

        # Setup context manager
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        db.pool = mock_pool
        return db, mock_conn

    @pytest.mark.asyncio
    async def test_connection_context_manager(self, db_with_pool):
        """connection() should yield a connection from the pool."""
        db, mock_conn = db_with_pool

        async with db.connection() as conn:
            assert conn == mock_conn

    @pytest.mark.asyncio
    async def test_connection_raises_when_no_pool(self):
        """connection() should raise RuntimeError when pool not initialized."""
        db = Database()
        db.pool = None

        with pytest.raises(RuntimeError, match="Database pool not initialized"):
            async with db.connection():
                pass

    @pytest.mark.asyncio
    async def test_execute(self, db_with_pool):
        """execute() should execute a query."""
        db, mock_conn = db_with_pool
        mock_conn.execute.return_value = "INSERT 1"

        result = await db.execute("INSERT INTO test VALUES ($1)", "value")

        assert result == "INSERT 1"
        mock_conn.execute.assert_called_once_with("INSERT INTO test VALUES ($1)", "value")

    @pytest.mark.asyncio
    async def test_fetch(self, db_with_pool):
        """fetch() should return all rows."""
        db, mock_conn = db_with_pool
        mock_rows = [{"id": 1}, {"id": 2}]
        mock_conn.fetch.return_value = mock_rows

        result = await db.fetch("SELECT * FROM test")

        assert result == mock_rows
        mock_conn.fetch.assert_called_once_with("SELECT * FROM test")

    @pytest.mark.asyncio
    async def test_fetchrow(self, db_with_pool):
        """fetchrow() should return first row."""
        db, mock_conn = db_with_pool
        mock_row = {"id": 1, "name": "test"}
        mock_conn.fetchrow.return_value = mock_row

        result = await db.fetchrow("SELECT * FROM test WHERE id = $1", 1)

        assert result == mock_row
        mock_conn.fetchrow.assert_called_once_with("SELECT * FROM test WHERE id = $1", 1)

    @pytest.mark.asyncio
    async def test_fetchval(self, db_with_pool):
        """fetchval() should return first value of first row."""
        db, mock_conn = db_with_pool
        mock_conn.fetchval.return_value = 42

        result = await db.fetchval("SELECT count(*) FROM test")

        assert result == 42
        mock_conn.fetchval.assert_called_once_with("SELECT count(*) FROM test")


class TestGlobalDatabase:
    """Tests for global database functions."""

    def test_get_database_creates_instance(self):
        """get_database() should create a new instance if none exists."""
        import src.db.pool as pool_module

        pool_module._database = None

        db = get_database()
        assert db is not None
        assert isinstance(db, Database)

        # Cleanup
        pool_module._database = None

    def test_get_database_returns_same_instance(self):
        """get_database() should return the same instance on subsequent calls."""
        import src.db.pool as pool_module

        pool_module._database = None

        db1 = get_database()
        db2 = get_database()
        assert db1 is db2

        # Cleanup
        pool_module._database = None

    @pytest.mark.asyncio
    async def test_init_database(self):
        """init_database() should initialize and connect the database."""
        import src.db.pool as pool_module

        pool_module._database = None

        with patch.object(Database, "connect", new_callable=AsyncMock) as mock_connect:
            db = await init_database()

            assert db is not None
            mock_connect.assert_called_once()

        # Cleanup
        pool_module._database = None

    @pytest.mark.asyncio
    async def test_close_database(self):
        """close_database() should disconnect and clear the global database."""
        import src.db.pool as pool_module

        mock_db = MagicMock(spec=Database)
        mock_db.disconnect = AsyncMock()
        pool_module._database = mock_db

        await close_database()

        mock_db.disconnect.assert_called_once()
        assert pool_module._database is None
