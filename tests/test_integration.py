"""Integration tests for Brain modules.

Tests that verify all Brain modules work together correctly.
"""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.state.focus import (
    get_daily_focus,
    set_daily_focus,
)
from src.state.tick import get_tick_status
from src.state.actions import create_task, execute_action, update_task
from src.state.goals import get_goal, list_objectives, update_objective_progress
from src.state.queue import (
    complete_prd,
    get_next_prd,
    get_queue,
    get_queue_summary,
    init_queue,
    start_current_prd,
)


@pytest.fixture
def mock_db():
    """Create mock database with comprehensive return values."""
    db = MagicMock()
    db.fetchrow = AsyncMock()
    db.fetchval = AsyncMock()
    db.fetch = AsyncMock()
    db.execute = AsyncMock()
    return db


class TestFocusTickIntegration:
    """Tests for Focus + Tick module integration."""

    @pytest.mark.asyncio
    async def test_tick_status_and_focus_work_together(self, mock_db):
        """Tick status and focus can be queried together."""
        # Setup tick status (tick stores {"enabled": True} format)
        tick_data = [
            {"key": "tick_enabled", "value_json": {"enabled": True}},
            {"key": "tick_last", "value_json": {"timestamp": "2024-01-01T00:00:00"}},
            {"key": "tick_actions_today", "value_json": {"count": 5}},
        ]
        mock_db.fetch.return_value = tick_data

        # Get tick status
        status = await get_tick_status(mock_db)
        assert status["enabled"] is True
        assert status["actions_today"] == 5

        # Setup focus data
        focus_data = {
            "objective_id": "obj-1",
        }
        objective = {
            "id": "obj-1",
            "title": "Build MVP",
            "status": "in_progress",
            "priority": "P0",
            "progress": 50,
        }
        key_results = [
            {"id": "kr-1", "title": "Complete API", "progress": 30, "weight": 1.0},
        ]
        tasks = [
            {"id": "task-1", "title": "Write tests", "status": "pending"},
        ]

        mock_db.fetchrow.side_effect = [
            {"value_json": json.dumps(focus_data)},
            objective,
        ]
        mock_db.fetch.side_effect = [
            key_results,
            tasks,
        ]

        # Get daily focus
        focus = await get_daily_focus(mock_db)
        assert focus is not None
        assert focus["focus"]["objective"]["id"] == "obj-1"

    @pytest.mark.asyncio
    async def test_manual_focus_override_persists(self, mock_db):
        """Manual focus override should store objective_id correctly."""
        objective = {
            "id": "obj-manual",
            "title": "Manual Focus",
            "status": "in_progress",
        }
        mock_db.fetchrow.return_value = objective

        result = await set_daily_focus(mock_db, "obj-manual")
        assert result["success"] is True

        # Verify objective_id is stored in working memory
        # execute(sql, key, value_json) -> call_args[0] = (sql, key, value_json)
        call_args = mock_db.execute.call_args[0]
        stored_data = json.loads(call_args[2])  # value_json is third param (index 2)
        assert stored_data["objective_id"] == "obj-manual"


class TestActionsGoalsIntegration:
    """Tests for Actions + Goals module integration."""

    @pytest.mark.asyncio
    async def test_create_task_action_creates_retrievable_task(self, mock_db):
        """Task created via action should be retrievable via goals module."""
        mock_db.fetchrow.return_value = {
            "id": "task-new",
            "title": "New Task",
            "status": "pending",
            "priority": "P1",
        }

        result = await execute_action(
            mock_db,
            "create-task",
            {
                "title": "New Task",
                "priority": "P1",
            },
        )

        assert result["success"] is True
        assert result["task"]["id"] == "task-new"

    @pytest.mark.asyncio
    async def test_update_task_reflects_in_goal_progress(self, mock_db):
        """Updating task status should allow goal progress recalculation."""
        mock_db.fetchrow.return_value = {
            "id": "task-1",
            "title": "Task 1",
            "status": "completed",
            "goal_id": "goal-1",
        }

        result = await execute_action(
            mock_db,
            "update-task",
            {
                "task_id": "task-1",
                "status": "completed",
            },
        )

        assert result["success"] is True

        # Recalculate goal progress
        mock_db.fetchrow.return_value = {
            "id": "goal-1",
            "title": "Goal 1",
            "type": "objective",
        }
        mock_db.fetch.return_value = [
            {"id": "kr-1", "progress": 100, "weight": 1.0},
        ]

        progress_result = await update_objective_progress(mock_db, "goal-1")
        assert progress_result["success"] is True

    @pytest.mark.asyncio
    async def test_create_goal_action_creates_retrievable_goal(self, mock_db):
        """Goal created via action should be retrievable."""
        mock_db.fetchrow.side_effect = [
            # create_goal returns new goal
            {
                "id": "goal-new",
                "title": "New Objective",
                "status": "pending",
            },
            # get_goal retrieves it
            {
                "id": "goal-new",
                "title": "New Objective",
                "status": "pending",
            },
        ]

        # Create via action
        create_result = await execute_action(
            mock_db,
            "create-goal",
            {
                "title": "New Objective",
            },
        )

        assert create_result["success"] is True

        # Retrieve via goals module
        goal = await get_goal(mock_db, "goal-new")
        assert goal is not None
        assert goal["title"] == "New Objective"


class TestQueueWorkflowIntegration:
    """Tests for Queue module workflow integration."""

    @pytest.mark.asyncio
    async def test_complete_queue_workflow(self, mock_db):
        """Test complete PRD queue workflow from init to completion."""
        # Step 1: Initialize queue
        mock_db.fetchrow.return_value = None

        queue = await init_queue(
            mock_db,
            prd_paths=["prd1.md", "prd2.md", "prd3.md"],
            project_path="/project",
        )

        assert len(queue["items"]) == 3
        assert queue["status"] == "ready"

        # Step 2: Get next PRD
        mock_db.fetchrow.return_value = {"value_json": queue}

        next_prd = await get_next_prd(mock_db)
        assert next_prd["id"] == 1
        assert next_prd["path"] == "prd1.md"

        # Step 3: Start PRD
        result = await start_current_prd(mock_db)
        assert result["success"] is True
        assert result["prd"]["status"] == "in_progress"

        # Step 4: Complete PRD
        queue["items"][0]["status"] = "in_progress"
        mock_db.fetchrow.return_value = {"value_json": queue}

        complete_result = await complete_prd(
            mock_db, prd_id=1, pr_url="https://pr/1", branch="feature-1"
        )
        assert complete_result["success"] is True
        assert complete_result["all_done"] is False
        assert complete_result["next"]["id"] == 2

    @pytest.mark.asyncio
    async def test_queue_summary_reflects_current_state(self, mock_db):
        """Queue summary should accurately reflect current state."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "done"},
                {"id": 2, "path": "prd2.md", "status": "in_progress"},
                {"id": 3, "path": "prd3.md", "status": "pending"},
            ],
            "status": "running",
            "project_path": "/project",
            "started_at": "2024-01-01T00:00:00",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        summary = await get_queue_summary(mock_db)

        assert summary["total"] == 3
        assert summary["done"] == 1
        assert summary["in_progress"] == 1
        assert summary["pending"] == 1
        assert summary["current"]["id"] == 2


class TestFullWorkflowIntegration:
    """Tests for complete end-to-end workflow."""

    @pytest.mark.asyncio
    async def test_focus_to_task_creation_workflow(self, mock_db):
        """Test workflow from setting focus to creating task."""
        # Step 1: Set focus on objective
        objective = {
            "id": "obj-1",
            "title": "Complete Feature",
            "status": "in_progress",
        }
        mock_db.fetchrow.return_value = objective

        focus_result = await set_daily_focus(mock_db, "obj-1")
        assert focus_result["success"] is True

        # Step 2: Create task related to focus
        mock_db.fetchrow.return_value = {
            "id": "task-1",
            "title": "Implement API",
            "status": "pending",
            "priority": "P1",
        }

        task_result = await create_task(
            mock_db,
            title="Implement API",
        )
        assert task_result["success"] is True

        # Step 3: Update task to in_progress via action
        mock_db.fetchrow.return_value = {
            "id": "task-1",
            "title": "Implement API",
            "status": "in_progress",
        }

        update_result = await update_task(
            mock_db,
            task_id="task-1",
            status="in_progress",
        )
        assert update_result["success"] is True

    @pytest.mark.asyncio
    async def test_objectives_listing_integration(self, mock_db):
        """Test listing objectives with various filters."""
        objectives = [
            {"id": "obj-1", "title": "Obj 1", "status": "in_progress", "priority": "P0"},
            {"id": "obj-2", "title": "Obj 2", "status": "pending", "priority": "P1"},
        ]
        mock_db.fetch.return_value = objectives

        result = await list_objectives(mock_db)
        assert len(result) == 2

        mock_db.fetch.return_value = [objectives[0]]
        result = await list_objectives(mock_db, status="in_progress")
        assert len(result) == 1
        assert result[0]["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_memory_operations_integration(self, mock_db):
        """Test working memory operations across modules."""
        mock_db.fetchrow.return_value = None

        result = await execute_action(
            mock_db,
            "set-memory",
            {
                "key": "last_decision",
                "value": {"action": "start_task", "task_id": "task-1"},
            },
        )

        assert result["success"] is True
        assert result["key"] == "last_decision"
        mock_db.execute.assert_called()


class TestErrorHandlingIntegration:
    """Tests for error handling across modules."""

    @pytest.mark.asyncio
    async def test_focus_handles_missing_objective(self, mock_db):
        """Focus should handle missing objective gracefully."""
        mock_db.fetchrow.return_value = None

        with pytest.raises(ValueError, match="not found"):
            await set_daily_focus(mock_db, "nonexistent-obj")

    @pytest.mark.asyncio
    async def test_queue_handles_empty_state(self, mock_db):
        """Queue should handle empty state gracefully."""
        mock_db.fetchrow.return_value = None

        queue = await get_queue(mock_db)
        assert queue["status"] == "idle"
        assert queue["items"] == []

        next_prd = await get_next_prd(mock_db)
        assert next_prd is None

    @pytest.mark.asyncio
    async def test_action_handles_invalid_action_name(self, mock_db):
        """Action should handle invalid action name."""
        with pytest.raises(ValueError, match="Unknown action"):
            await execute_action(mock_db, "invalid-action", {})

    @pytest.mark.asyncio
    async def test_goal_handles_not_found(self, mock_db):
        """Goal module should handle not found gracefully."""
        mock_db.fetchrow.return_value = None

        goal = await get_goal(mock_db, "nonexistent")
        assert goal is None
