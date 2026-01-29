"""Tests for OKR Goals Management."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.state.goals import (
    delete_goal,
    get_goal,
    get_goals_summary,
    get_objective_with_tasks,
    list_key_results,
    list_objectives,
    update_objective_progress,
)


class TestListObjectives:
    """Tests for list_objectives function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_lists_all_objectives(self, mock_db):
        """Lists all objectives without filters."""
        mock_db.fetch.return_value = [
            {
                "id": "obj-1",
                "title": "Objective 1",
                "priority": "P0",
                "status": "in_progress",
                "progress": 50,
            },
            {
                "id": "obj-2",
                "title": "Objective 2",
                "priority": "P1",
                "status": "pending",
                "progress": 0,
            },
        ]

        result = await list_objectives(mock_db)

        assert len(result) == 2
        assert result[0]["id"] == "obj-1"

    @pytest.mark.asyncio
    async def test_filters_by_status(self, mock_db):
        """Filters objectives by status."""
        mock_db.fetch.return_value = [
            {"id": "obj-1", "title": "Active", "status": "in_progress"},
        ]

        result = await list_objectives(mock_db, status="in_progress")

        assert len(result) == 1
        # Verify query includes status filter
        call_args = mock_db.fetch.call_args[0]
        assert "status = $1" in call_args[0]

    @pytest.mark.asyncio
    async def test_filters_by_priority(self, mock_db):
        """Filters objectives by priority."""
        mock_db.fetch.return_value = [
            {"id": "obj-1", "title": "Urgent", "priority": "P0"},
        ]

        result = await list_objectives(mock_db, priority="P0")

        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_respects_limit(self, mock_db):
        """Respects limit parameter."""
        mock_db.fetch.return_value = []

        await list_objectives(mock_db, limit=10)

        # Verify limit is passed
        call_args = mock_db.fetch.call_args[0]
        assert 10 in call_args


class TestListKeyResults:
    """Tests for list_key_results function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_lists_key_results_for_objective(self, mock_db):
        """Lists key results for an objective."""
        mock_db.fetch.return_value = [
            {"id": "kr-1", "title": "KR 1", "progress": 30, "weight": 1},
            {"id": "kr-2", "title": "KR 2", "progress": 60, "weight": 2},
        ]

        result = await list_key_results(mock_db, "obj-1")

        assert len(result) == 2
        call_args = mock_db.fetch.call_args[0]
        assert "parent_id = $1" in call_args[0]
        assert "obj-1" in call_args

    @pytest.mark.asyncio
    async def test_filters_by_status(self, mock_db):
        """Filters key results by status."""
        mock_db.fetch.return_value = []

        await list_key_results(mock_db, "obj-1", status="completed")

        call_args = mock_db.fetch.call_args[0]
        assert "status = $2" in call_args[0]


class TestGetGoal:
    """Tests for get_goal function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_goal_with_key_results(self, mock_db):
        """Returns goal with key results if objective."""
        mock_db.fetchrow.return_value = {
            "id": "obj-1",
            "title": "Test Objective",
            "type": "objective",
            "status": "in_progress",
            "progress": 50,
        }
        mock_db.fetch.return_value = [
            {"id": "kr-1", "title": "KR 1", "progress": 50},
        ]

        result = await get_goal(mock_db, "obj-1")

        assert result["id"] == "obj-1"
        assert "key_results" in result
        assert len(result["key_results"]) == 1

    @pytest.mark.asyncio
    async def test_returns_none_if_not_found(self, mock_db):
        """Returns None if goal not found."""
        mock_db.fetchrow.return_value = None

        result = await get_goal(mock_db, "nonexistent")

        assert result is None

    @pytest.mark.asyncio
    async def test_skips_key_results_for_kr_type(self, mock_db):
        """Does not fetch key results for key_result type."""
        mock_db.fetchrow.return_value = {
            "id": "kr-1",
            "title": "Key Result",
            "type": "key_result",
        }

        result = await get_goal(mock_db, "kr-1")

        assert "key_results" not in result
        mock_db.fetch.assert_not_called()


class TestGetObjectiveWithTasks:
    """Tests for get_objective_with_tasks function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_objective_with_tasks(self, mock_db):
        """Returns objective with tasks."""
        mock_db.fetchrow.return_value = {
            "id": "obj-1",
            "title": "Test Objective",
            "type": "objective",
            "progress": 50,
        }
        mock_db.fetch.side_effect = [
            # Key results
            [{"id": "kr-1", "progress": 50, "weight": 1}],
            # Tasks
            [{"id": "task-1", "title": "Task 1", "status": "queued"}],
        ]

        result = await get_objective_with_tasks(mock_db, "obj-1")

        assert result["id"] == "obj-1"
        assert "tasks" in result
        assert len(result["tasks"]) == 1
        assert "calculated_progress" in result

    @pytest.mark.asyncio
    async def test_returns_none_if_not_found(self, mock_db):
        """Returns None if objective not found."""
        mock_db.fetchrow.return_value = None

        result = await get_objective_with_tasks(mock_db, "nonexistent")

        assert result is None

    @pytest.mark.asyncio
    async def test_calculates_weighted_progress(self, mock_db):
        """Calculates weighted progress from key results."""
        mock_db.fetchrow.return_value = {
            "id": "obj-1",
            "title": "Test",
            "type": "objective",
        }
        mock_db.fetch.side_effect = [
            # Key results with different weights
            [
                {"id": "kr-1", "progress": 100, "weight": 1},
                {"id": "kr-2", "progress": 0, "weight": 1},
            ],
            # Tasks
            [],
        ]

        result = await get_objective_with_tasks(mock_db, "obj-1")

        # (100*1 + 0*1) / 2 = 50
        assert result["calculated_progress"] == 50


class TestDeleteGoal:
    """Tests for delete_goal function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_deletes_goal(self, mock_db):
        """Deletes a goal successfully."""
        mock_db.fetchrow.side_effect = [
            {"id": "kr-1", "type": "key_result"},  # Goal exists
        ]

        result = await delete_goal(mock_db, "kr-1")

        assert result["success"] is True
        assert result["deleted_id"] == "kr-1"

    @pytest.mark.asyncio
    async def test_returns_error_if_not_found(self, mock_db):
        """Returns error if goal not found."""
        mock_db.fetchrow.return_value = None

        result = await delete_goal(mock_db, "nonexistent")

        assert result["success"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_blocks_delete_with_children(self, mock_db):
        """Blocks deletion of objective with children."""
        mock_db.fetchrow.side_effect = [
            {"id": "obj-1", "type": "objective"},  # Goal exists
            {"count": 2},  # Has 2 children
        ]

        result = await delete_goal(mock_db, "obj-1", cascade=False)

        assert result["success"] is False
        assert "key results" in result["error"]

    @pytest.mark.asyncio
    async def test_cascade_deletes_children(self, mock_db):
        """Cascade deletes children."""
        mock_db.fetchrow.return_value = {"id": "obj-1", "type": "objective"}

        result = await delete_goal(mock_db, "obj-1", cascade=True)

        assert result["success"] is True
        # Verify child deletion was called
        assert mock_db.execute.call_count == 2  # Delete children + delete parent


class TestUpdateObjectiveProgress:
    """Tests for update_objective_progress function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_calculates_weighted_progress(self, mock_db):
        """Calculates weighted average progress."""
        mock_db.fetch.return_value = [
            {"progress": 100, "weight": 2},
            {"progress": 50, "weight": 1},
        ]

        result = await update_objective_progress(mock_db, "obj-1")

        # (100*2 + 50*1) / 3 = 83.33 -> 83
        assert result["success"] is True
        assert result["progress"] == 83

    @pytest.mark.asyncio
    async def test_returns_zero_if_no_key_results(self, mock_db):
        """Returns zero progress if no key results."""
        mock_db.fetch.return_value = []

        result = await update_objective_progress(mock_db, "obj-1")

        assert result["success"] is True
        assert result["progress"] == 0
        assert "No key results" in result.get("reason", "")


class TestGetGoalsSummary:
    """Tests for get_goals_summary function."""

    @pytest.fixture
    def mock_db(self):
        """Create mock database."""
        db = MagicMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_summary_statistics(self, mock_db):
        """Returns summary statistics."""
        mock_db.fetch.side_effect = [
            # Objectives
            [
                {"status": "in_progress", "count": 3},
                {"status": "completed", "count": 2},
            ],
            # Key results
            [
                {"status": "pending", "count": 5},
                {"status": "in_progress", "count": 3},
            ],
        ]

        result = await get_goals_summary(mock_db)

        assert result["objectives"]["total"] == 5
        assert result["objectives"]["by_status"]["in_progress"] == 3
        assert result["key_results"]["total"] == 8

    @pytest.mark.asyncio
    async def test_filters_by_project(self, mock_db):
        """Filters by project when specified."""
        mock_db.fetch.side_effect = [[], []]

        await get_goals_summary(mock_db, project_id="proj-1")

        # Verify project filter in queries
        call_args = mock_db.fetch.call_args_list[0][0]
        assert "project_id = $1" in call_args[0]
