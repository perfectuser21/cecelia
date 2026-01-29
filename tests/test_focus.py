"""Tests for Focus functionality."""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from src.state.focus import (
    select_daily_focus,
    get_daily_focus,
    set_daily_focus,
    clear_daily_focus,
    get_focus_summary,
    FOCUS_OVERRIDE_KEY,
    _generate_reason,
)


class TestGenerateReason:
    """Tests for _generate_reason helper."""

    def test_pinned_objective(self):
        """Should include pinned status in reason."""
        objective = {"metadata": {"is_pinned": True}}
        reason = _generate_reason(objective)
        assert "已置顶" in reason

    def test_p0_priority(self):
        """Should include P0 priority in reason."""
        objective = {"priority": "P0"}
        reason = _generate_reason(objective)
        assert "P0 最高优先级" in reason

    def test_p1_priority(self):
        """Should include P1 priority in reason."""
        objective = {"priority": "P1"}
        reason = _generate_reason(objective)
        assert "P1 高优先级" in reason

    def test_near_completion(self):
        """Should mention near completion for 80%+ progress."""
        objective = {"progress": 85}
        reason = _generate_reason(objective)
        assert "接近完成" in reason
        assert "85%" in reason

    def test_partial_progress(self):
        """Should mention current progress for partial completion."""
        objective = {"progress": 50}
        reason = _generate_reason(objective)
        assert "当前进度 50%" in reason

    def test_no_special_attributes(self):
        """Should default to 'recently active'."""
        objective = {}
        reason = _generate_reason(objective)
        assert "最近有活动" in reason

    def test_multiple_reasons(self):
        """Should combine multiple reasons."""
        objective = {"metadata": {"is_pinned": True}, "priority": "P0", "progress": 90}
        reason = _generate_reason(objective)
        assert "已置顶" in reason
        assert "P0 最高优先级" in reason
        assert "接近完成" in reason

    def test_metadata_as_string(self):
        """Should handle metadata as JSON string."""
        objective = {"metadata": json.dumps({"is_pinned": True})}
        reason = _generate_reason(objective)
        assert "已置顶" in reason


class TestSelectDailyFocus:
    """Tests for select_daily_focus function."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.fetch = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_manual_override(self, mock_db):
        """Should return manually set objective first."""
        # Setup: manual override exists
        mock_db.fetchrow.side_effect = [
            {"value_json": {"objective_id": "obj-123"}},  # working_memory
            {"id": "obj-123", "title": "Manual Focus", "type": "objective"},  # goals
        ]

        result = await select_daily_focus(mock_db)

        assert result is not None
        assert result["is_manual"] is True
        assert result["objective"]["id"] == "obj-123"
        assert result["reason"] == "手动设置的焦点"

    @pytest.mark.asyncio
    async def test_returns_auto_selected_objective(self, mock_db):
        """Should auto-select objective when no manual override."""
        # Setup: no manual override
        mock_db.fetchrow.side_effect = [
            None,  # no working_memory override
            {  # auto-selected objective
                "id": "obj-456",
                "title": "Auto Focus",
                "priority": "P0",
                "progress": 85,
                "metadata": None,
            },
        ]

        result = await select_daily_focus(mock_db)

        assert result is not None
        assert result["is_manual"] is False
        assert result["objective"]["id"] == "obj-456"
        assert "P0 最高优先级" in result["reason"]

    @pytest.mark.asyncio
    async def test_returns_none_when_no_objectives(self, mock_db):
        """Should return None when no objectives exist."""
        mock_db.fetchrow.side_effect = [
            None,  # no working_memory override
            None,  # no objectives
        ]

        result = await select_daily_focus(mock_db)

        assert result is None

    @pytest.mark.asyncio
    async def test_handles_string_value_json(self, mock_db):
        """Should handle value_json as string."""
        mock_db.fetchrow.side_effect = [
            {"value_json": json.dumps({"objective_id": "obj-789"})},
            {"id": "obj-789", "title": "Test", "type": "objective"},
        ]

        result = await select_daily_focus(mock_db)

        assert result is not None
        assert result["objective"]["id"] == "obj-789"


class TestGetDailyFocus:
    """Tests for get_daily_focus function."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_full_details(self, mock_db):
        """Should return objective with key results and tasks."""
        mock_db.fetchrow.side_effect = [
            None,  # no override
            {  # objective
                "id": "obj-1",
                "title": "Test Objective",
                "description": "Test description",
                "priority": "P1",
                "progress": 50,
                "status": "active",
                "metadata": None,
            },
        ]
        mock_db.fetch.side_effect = [
            [  # key results
                {
                    "id": "kr-1",
                    "title": "KR 1",
                    "progress": 30,
                    "weight": 1.0,
                    "status": "active",
                }
            ],
            [  # tasks
                {"id": "task-1", "title": "Task 1", "status": "pending", "priority": "P1"}
            ],
        ]

        result = await get_daily_focus(mock_db)

        assert result is not None
        assert result["focus"]["objective"]["id"] == "obj-1"
        assert len(result["focus"]["key_results"]) == 1
        assert len(result["focus"]["suggested_tasks"]) == 1

    @pytest.mark.asyncio
    async def test_returns_none_when_no_focus(self, mock_db):
        """Should return None when no focus objective."""
        mock_db.fetchrow.side_effect = [None, None]

        result = await get_daily_focus(mock_db)

        assert result is None


class TestSetDailyFocus:
    """Tests for set_daily_focus function."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_sets_focus_successfully(self, mock_db):
        """Should set focus and return success."""
        mock_db.fetchrow.return_value = {"id": "obj-123"}

        result = await set_daily_focus(mock_db, "obj-123")

        assert result["success"] is True
        assert result["objective_id"] == "obj-123"
        mock_db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_raises_when_objective_not_found(self, mock_db):
        """Should raise ValueError when objective doesn't exist."""
        mock_db.fetchrow.return_value = None

        with pytest.raises(ValueError, match="Objective not found"):
            await set_daily_focus(mock_db, "nonexistent")


class TestClearDailyFocus:
    """Tests for clear_daily_focus function."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database."""
        db = MagicMock()
        db.execute = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_clears_focus(self, mock_db):
        """Should clear focus override."""
        result = await clear_daily_focus(mock_db)

        assert result["success"] is True
        mock_db.execute.assert_called_once_with(
            "DELETE FROM working_memory WHERE key = $1",
            FOCUS_OVERRIDE_KEY,
        )


class TestGetFocusSummary:
    """Tests for get_focus_summary function."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database."""
        db = MagicMock()
        db.fetchrow = AsyncMock()
        db.fetch = AsyncMock()
        return db

    @pytest.mark.asyncio
    async def test_returns_summary(self, mock_db):
        """Should return focus summary."""
        mock_db.fetchrow.side_effect = [
            None,  # no override
            {
                "id": "obj-1",
                "title": "Test",
                "priority": "P0",
                "progress": 75,
                "metadata": None,
            },
        ]
        mock_db.fetch.return_value = [{"id": "kr-1", "title": "KR 1", "progress": 50}]

        result = await get_focus_summary(mock_db)

        assert result is not None
        assert result["objective_id"] == "obj-1"
        assert result["priority"] == "P0"
        assert len(result["key_results"]) == 1

    @pytest.mark.asyncio
    async def test_returns_none_when_no_focus(self, mock_db):
        """Should return None when no focus."""
        mock_db.fetchrow.side_effect = [None, None]

        result = await get_focus_summary(mock_db)

        assert result is None
