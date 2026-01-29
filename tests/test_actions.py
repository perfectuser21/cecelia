"""Tests for Brain Actions."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.state.actions import (
    ACTION_HANDLERS,
    batch_update_tasks,
    create_goal,
    create_task,
    execute_action,
    log_decision,
    set_memory,
    update_goal,
    update_task,
)


class TestCreateTask:
    """Tests for create_task function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_creates_task_with_required_fields(self, mock_db):
        """Creates task with minimal required fields."""
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "Test Task",
            "description": "",
            "priority": "P1",
            "project_id": None,
            "goal_id": None,
            "tags": [],
            "status": "queued",
        }

        result = await create_task(mock_db, title="Test Task")

        assert result["success"] is True
        assert result["task"]["title"] == "Test Task"
        assert result["task"]["status"] == "queued"

    @pytest.mark.asyncio
    async def test_creates_task_with_all_fields(self, mock_db):
        """Creates task with all optional fields."""
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "Full Task",
            "description": "A detailed description",
            "priority": "P0",
            "project_id": "proj-1",
            "goal_id": "goal-1",
            "tags": ["urgent", "feature"],
            "status": "queued",
        }

        result = await create_task(
            mock_db,
            title="Full Task",
            description="A detailed description",
            priority="P0",
            project_id="proj-1",
            goal_id="goal-1",
            tags=["urgent", "feature"],
        )

        assert result["success"] is True
        assert result["task"]["priority"] == "P0"
        assert result["task"]["goal_id"] == "goal-1"


class TestUpdateTask:
    """Tests for update_task function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_updates_task_status(self, mock_db):
        """Updates task status."""
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "Test Task",
            "status": "in_progress",
            "priority": "P1",
        }

        result = await update_task(mock_db, task_id="task-123", status="in_progress")

        assert result["success"] is True
        assert result["task"]["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_updates_task_priority(self, mock_db):
        """Updates task priority."""
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "Test Task",
            "status": "queued",
            "priority": "P0",
        }

        result = await update_task(mock_db, task_id="task-123", priority="P0")

        assert result["success"] is True
        assert result["task"]["priority"] == "P0"

    @pytest.mark.asyncio
    async def test_returns_error_when_no_updates(self, mock_db):
        """Returns error when no updates provided."""
        result = await update_task(mock_db, task_id="task-123")

        assert result["success"] is False
        assert "No updates provided" in result["error"]

    @pytest.mark.asyncio
    async def test_returns_error_when_task_not_found(self, mock_db):
        """Returns error when task not found."""
        mock_db.fetchrow.return_value = None

        result = await update_task(mock_db, task_id="nonexistent", status="in_progress")

        assert result["success"] is False
        assert "Task not found" in result["error"]


class TestCreateGoal:
    """Tests for create_goal function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_creates_goal_with_required_fields(self, mock_db):
        """Creates goal with minimal required fields."""
        mock_db.fetchrow.return_value = {
            "id": "goal-123",
            "title": "Test Goal",
            "description": "",
            "priority": "P1",
            "project_id": None,
            "target_date": None,
            "type": "objective",
            "parent_id": None,
            "status": "pending",
            "progress": 0,
        }

        result = await create_goal(mock_db, title="Test Goal")

        assert result["success"] is True
        assert result["goal"]["title"] == "Test Goal"
        assert result["goal"]["status"] == "pending"

    @pytest.mark.asyncio
    async def test_creates_key_result_with_parent(self, mock_db):
        """Creates key result linked to parent objective."""
        mock_db.fetchrow.return_value = {
            "id": "kr-123",
            "title": "Key Result",
            "description": "",
            "priority": "P1",
            "project_id": None,
            "target_date": None,
            "type": "key_result",
            "parent_id": "obj-1",
            "status": "pending",
            "progress": 0,
        }

        result = await create_goal(
            mock_db,
            title="Key Result",
            goal_type="key_result",
            parent_id="obj-1",
        )

        assert result["success"] is True
        assert result["goal"]["type"] == "key_result"
        assert result["goal"]["parent_id"] == "obj-1"


class TestUpdateGoal:
    """Tests for update_goal function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_updates_goal_status(self, mock_db):
        """Updates goal status."""
        mock_db.fetchrow.return_value = {
            "id": "goal-123",
            "title": "Test Goal",
            "status": "in_progress",
            "progress": 0,
        }

        result = await update_goal(mock_db, goal_id="goal-123", status="in_progress")

        assert result["success"] is True
        assert result["goal"]["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_updates_goal_progress(self, mock_db):
        """Updates goal progress."""
        mock_db.fetchrow.return_value = {
            "id": "goal-123",
            "title": "Test Goal",
            "status": "in_progress",
            "progress": 50,
        }

        result = await update_goal(mock_db, goal_id="goal-123", progress=50)

        assert result["success"] is True
        assert result["goal"]["progress"] == 50

    @pytest.mark.asyncio
    async def test_returns_error_when_no_updates(self, mock_db):
        """Returns error when no updates provided."""
        result = await update_goal(mock_db, goal_id="goal-123")

        assert result["success"] is False
        assert "No updates provided" in result["error"]

    @pytest.mark.asyncio
    async def test_returns_error_when_goal_not_found(self, mock_db):
        """Returns error when goal not found."""
        mock_db.fetchrow.return_value = None

        result = await update_goal(
            mock_db, goal_id="nonexistent", status="in_progress"
        )

        assert result["success"] is False
        assert "Goal not found" in result["error"]


class TestSetMemory:
    """Tests for set_memory function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_sets_string_value(self, mock_db):
        """Sets string value in memory."""
        result = await set_memory(mock_db, key="test_key", value="test_value")

        assert result["success"] is True
        assert result["key"] == "test_key"
        assert result["value"] == "test_value"

    @pytest.mark.asyncio
    async def test_sets_dict_value(self, mock_db):
        """Sets dict value in memory (JSON serialized)."""
        value = {"nested": "data", "count": 42}
        result = await set_memory(mock_db, key="config", value=value)

        assert result["success"] is True
        assert result["value"] == value
        # Verify JSON was stored
        call_args = mock_db.execute.call_args[0]
        assert json.dumps(value) in call_args


class TestLogDecision:
    """Tests for log_decision function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_logs_successful_decision(self, mock_db):
        """Logs decision with success status."""
        result = await log_decision(
            mock_db,
            trigger="tick",
            input_summary="Started task",
            decision={"action": "update-task"},
            result={"success": True},
        )

        assert result["success"] is True
        call_args = mock_db.execute.call_args[0]
        assert "tick" in call_args
        assert "success" in call_args[-1]

    @pytest.mark.asyncio
    async def test_logs_failed_decision(self, mock_db):
        """Logs decision with failed status."""
        result = await log_decision(
            mock_db,
            trigger="manual",
            input_summary="Failed operation",
            decision={"action": "create-task"},
            result={"success": False},
        )

        assert result["success"] is True
        call_args = mock_db.execute.call_args[0]
        assert "failed" in call_args[-1]


class TestBatchUpdateTasks:
    """Tests for batch_update_tasks function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_batch_updates_by_status(self, mock_db):
        """Batch updates tasks filtered by status."""
        mock_db.fetch.return_value = [{"id": "task-1"}, {"id": "task-2"}]

        result = await batch_update_tasks(
            mock_db,
            filter_criteria={"status": "queued"},
            update_values={"status": "paused"},
        )

        assert result["success"] is True
        assert result["count"] == 2

    @pytest.mark.asyncio
    async def test_batch_updates_by_project(self, mock_db):
        """Batch updates tasks filtered by project."""
        mock_db.fetch.return_value = [{"id": "task-1"}]

        result = await batch_update_tasks(
            mock_db,
            filter_criteria={"project_id": "proj-1"},
            update_values={"priority": "P0"},
        )

        assert result["success"] is True
        assert result["count"] == 1

    @pytest.mark.asyncio
    async def test_returns_error_when_no_updates(self, mock_db):
        """Returns error when no update values provided."""
        result = await batch_update_tasks(
            mock_db,
            filter_criteria={"status": "queued"},
            update_values={},
        )

        assert result["success"] is False
        assert "No updates provided" in result["error"]


class TestExecuteAction:
    """Tests for execute_action dispatcher."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.execute = AsyncMock()
        return db

    def test_action_handlers_registered(self):
        """All expected action handlers are registered."""
        expected = [
            "create-task",
            "update-task",
            "create-goal",
            "update-goal",
            "set-memory",
            "log-decision",
            "batch-update-tasks",
        ]
        for action in expected:
            assert action in ACTION_HANDLERS

    @pytest.mark.asyncio
    async def test_executes_create_task(self, mock_db):
        """Executes create-task action."""
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "New Task",
            "description": "",
            "priority": "P1",
            "project_id": None,
            "goal_id": None,
            "tags": [],
            "status": "queued",
        }

        result = await execute_action(
            mock_db, "create-task", {"title": "New Task"}
        )

        assert result["success"] is True
        assert result["task"]["title"] == "New Task"

    @pytest.mark.asyncio
    async def test_executes_set_memory(self, mock_db):
        """Executes set-memory action."""
        result = await execute_action(
            mock_db, "set-memory", {"key": "test", "value": "data"}
        )

        assert result["success"] is True
        assert result["key"] == "test"

    @pytest.mark.asyncio
    async def test_raises_error_for_unknown_action(self, mock_db):
        """Raises ValueError for unknown action."""
        with pytest.raises(ValueError, match="Unknown action"):
            await execute_action(mock_db, "unknown-action", {})
