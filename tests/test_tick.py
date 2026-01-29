"""Tests for Tick mechanism."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.state.tick import (
    STALE_THRESHOLD_HOURS,
    TICK_ACTIONS_TODAY_KEY,
    TICK_ENABLED_KEY,
    TICK_INTERVAL_MINUTES,
    TICK_LAST_KEY,
    disable_tick,
    enable_tick,
    execute_tick,
    get_tick_status,
    is_stale,
)


class TestIsStale:
    """Tests for is_stale function."""

    def test_non_in_progress_not_stale(self):
        """Task not in_progress is not stale."""
        task = {"status": "queued", "started_at": None}
        assert is_stale(task) is False

    def test_no_started_at_not_stale(self):
        """Task without started_at is not stale."""
        task = {"status": "in_progress", "started_at": None}
        assert is_stale(task) is False

    def test_recent_task_not_stale(self):
        """Recently started task is not stale."""
        now = datetime.now(timezone.utc)
        task = {
            "status": "in_progress",
            "started_at": now - timedelta(hours=1),
        }
        assert is_stale(task) is False

    def test_old_task_is_stale(self):
        """Task started over threshold hours ago is stale."""
        now = datetime.now(timezone.utc)
        task = {
            "status": "in_progress",
            "started_at": now - timedelta(hours=STALE_THRESHOLD_HOURS + 1),
        }
        assert is_stale(task) is True

    def test_string_timestamp_parsed(self):
        """String timestamp is properly parsed."""
        now = datetime.now(timezone.utc)
        old_time = now - timedelta(hours=STALE_THRESHOLD_HOURS + 1)
        task = {
            "status": "in_progress",
            "started_at": old_time.isoformat(),
        }
        assert is_stale(task) is True


class TestGetTickStatus:
    """Tests for get_tick_status function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_default_when_no_data(self, mock_db):
        """Returns default values when no data in DB."""
        mock_db.fetch.return_value = []

        result = await get_tick_status(mock_db)

        assert result["enabled"] is False
        assert result["interval_minutes"] == TICK_INTERVAL_MINUTES
        assert result["last_tick"] is None
        assert result["next_tick"] is None
        assert result["actions_today"] == 0

    @pytest.mark.asyncio
    async def test_returns_enabled_status(self, mock_db):
        """Returns enabled status from DB."""
        mock_db.fetch.return_value = [
            {"key": TICK_ENABLED_KEY, "value_json": json.dumps({"enabled": True})},
        ]

        result = await get_tick_status(mock_db)

        assert result["enabled"] is True

    @pytest.mark.asyncio
    async def test_returns_last_tick_and_next_tick(self, mock_db):
        """Returns last and next tick times."""
        last_time = datetime.utcnow().isoformat()
        mock_db.fetch.return_value = [
            {"key": TICK_ENABLED_KEY, "value_json": json.dumps({"enabled": True})},
            {"key": TICK_LAST_KEY, "value_json": json.dumps({"timestamp": last_time})},
        ]

        result = await get_tick_status(mock_db)

        assert result["last_tick"] == last_time
        assert result["next_tick"] is not None

    @pytest.mark.asyncio
    async def test_returns_actions_today(self, mock_db):
        """Returns actions count for today."""
        mock_db.fetch.return_value = [
            {
                "key": TICK_ACTIONS_TODAY_KEY,
                "value_json": json.dumps({"date": "2024-01-01", "count": 5}),
            },
        ]

        result = await get_tick_status(mock_db)

        assert result["actions_today"] == 5


class TestEnableTick:
    """Tests for enable_tick function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_enables_tick(self, mock_db):
        """Enable tick stores enabled=True."""
        result = await enable_tick(mock_db)

        assert result["success"] is True
        assert result["enabled"] is True
        mock_db.execute.assert_called_once()
        # Check the SQL contains the key and the JSON has enabled: true
        call_args = mock_db.execute.call_args[0]
        assert any(TICK_ENABLED_KEY in str(arg) for arg in call_args)
        assert any('"enabled": true' in str(arg) for arg in call_args)


class TestDisableTick:
    """Tests for disable_tick function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_disables_tick(self, mock_db):
        """Disable tick stores enabled=False."""
        result = await disable_tick(mock_db)

        assert result["success"] is True
        assert result["enabled"] is False
        mock_db.execute.assert_called_once()
        # Check the SQL contains the key and the JSON has enabled: false
        call_args = mock_db.execute.call_args[0]
        assert any(TICK_ENABLED_KEY in str(arg) for arg in call_args)
        assert any('"enabled": false' in str(arg) for arg in call_args)


class TestExecuteTick:
    """Tests for execute_tick function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        db.fetchrow = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_no_focus_reason(self, mock_db):
        """Returns reason when no focus is set."""
        # get_daily_focus returns None
        mock_db.fetchrow.return_value = None
        mock_db.fetch.return_value = []

        result = await execute_tick(mock_db)

        assert result["success"] is True
        assert result["actions_taken"] == []
        assert "No active Objective" in result["reason"]

    @pytest.mark.asyncio
    async def test_starts_next_task_when_none_in_progress(self, mock_db):
        """Starts next queued task when no task in progress."""
        # First fetchrow call for focus override (None = no override)
        # Second fetchrow call for select_daily_focus
        # Third fetchrow call for update_task
        # Fourth fetchrow call for _increment_actions_today
        mock_db.fetchrow.side_effect = [
            None,  # No manual override
            {
                "id": "obj-1",
                "title": "Test Objective",
                "priority": "P0",
                "progress": 0,
                "status": "in_progress",
                "type": "objective",
            },
            {
                "id": "task-1",
                "title": "Updated Task",
                "status": "in_progress",
                "priority": "P1",
            },
            None,  # _increment_actions_today lookup (no existing record)
        ]

        # Mock key results and tasks
        mock_db.fetch.side_effect = [
            # Key results for objective
            [],
            # Suggested tasks
            [],
            # Tasks for tick execution
            [
                {
                    "id": "task-1",
                    "title": "Test Task",
                    "status": "queued",
                    "priority": "P1",
                    "started_at": None,
                }
            ],
        ]

        result = await execute_tick(mock_db)

        assert result["success"] is True
        assert len(result["actions_taken"]) == 1
        assert result["actions_taken"][0]["action"] == "update-task"
        assert result["actions_taken"][0]["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_waits_when_task_in_progress(self, mock_db):
        """Logs wait when task already in progress."""
        # Mock focus result
        mock_db.fetchrow.side_effect = [
            None,  # No manual override
            {
                "id": "obj-1",
                "title": "Test Objective",
                "priority": "P0",
                "progress": 0,
                "status": "in_progress",
                "type": "objective",
            },
        ]

        # Mock key results and tasks
        mock_db.fetch.side_effect = [
            # Key results for objective
            [],
            # Suggested tasks
            [],
            # Tasks for tick execution - one in progress
            [
                {
                    "id": "task-1",
                    "title": "Working Task",
                    "status": "in_progress",
                    "priority": "P1",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
        ]

        result = await execute_tick(mock_db)

        assert result["success"] is True
        # No new actions started
        assert len(result["actions_taken"]) == 0
        assert result["summary"]["in_progress"] == 1

    @pytest.mark.asyncio
    async def test_detects_stale_tasks(self, mock_db):
        """Detects and reports stale tasks."""
        # Mock focus result
        old_time = datetime.now(timezone.utc) - timedelta(
            hours=STALE_THRESHOLD_HOURS + 1
        )

        mock_db.fetchrow.side_effect = [
            None,  # No manual override
            {
                "id": "obj-1",
                "title": "Test Objective",
                "priority": "P0",
                "progress": 0,
                "status": "in_progress",
                "type": "objective",
            },
            None,  # _increment_actions_today lookup (no existing record)
        ]

        # Mock key results and tasks
        mock_db.fetch.side_effect = [
            # Key results for objective
            [],
            # Suggested tasks
            [],
            # Tasks for tick execution - one stale
            [
                {
                    "id": "task-1",
                    "title": "Stale Task",
                    "status": "in_progress",
                    "priority": "P1",
                    "started_at": old_time,
                }
            ],
        ]

        result = await execute_tick(mock_db)

        assert result["success"] is True
        assert len(result["actions_taken"]) == 1
        assert result["actions_taken"][0]["action"] == "detect_stale"
        assert result["summary"]["stale"] == 1
