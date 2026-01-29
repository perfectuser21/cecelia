"""Tests for PRD Queue module."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.state.queue import (
    PRD_QUEUE_KEY,
    clear_queue,
    complete_prd,
    fail_prd,
    get_next_prd,
    get_queue,
    get_queue_summary,
    init_queue,
    retry_failed,
    start_current_prd,
)


@pytest.fixture
def mock_db():
    """Create mock database."""
    db = MagicMock()
    db.fetchrow = AsyncMock()
    db.execute = AsyncMock()
    return db


class TestGetQueue:
    """Tests for get_queue function."""

    @pytest.mark.asyncio
    async def test_returns_empty_queue_when_no_data(self, mock_db):
        """Should return empty queue state when no data exists."""
        mock_db.fetchrow.return_value = None

        result = await get_queue(mock_db)

        assert result["items"] == []
        assert result["current_index"] == -1
        assert result["status"] == "idle"
        assert result["started_at"] is None
        assert result["updated_at"] is None

    @pytest.mark.asyncio
    async def test_returns_queue_from_json_string(self, mock_db):
        """Should parse queue from JSON string."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "pending"}],
            "current_index": 0,
            "status": "ready",
            "started_at": None,
            "updated_at": "2024-01-01T00:00:00",
        }
        mock_db.fetchrow.return_value = {"value_json": json.dumps(queue_data)}

        result = await get_queue(mock_db)

        assert result["items"] == queue_data["items"]
        assert result["status"] == "ready"

    @pytest.mark.asyncio
    async def test_returns_queue_from_dict(self, mock_db):
        """Should return queue when value_json is already a dict."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "done"}],
            "current_index": 0,
            "status": "completed",
            "started_at": "2024-01-01T00:00:00",
            "updated_at": "2024-01-01T01:00:00",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await get_queue(mock_db)

        assert result == queue_data


class TestInitQueue:
    """Tests for init_queue function."""

    @pytest.mark.asyncio
    async def test_initializes_queue_with_prds(self, mock_db):
        """Should initialize queue with PRD paths."""
        prd_paths = ["prd1.md", "prd2.md", "prd3.md"]

        result = await init_queue(mock_db, prd_paths)

        assert len(result["items"]) == 3
        assert result["items"][0]["id"] == 1
        assert result["items"][0]["path"] == "prd1.md"
        assert result["items"][0]["status"] == "pending"
        assert result["current_index"] == 0
        assert result["status"] == "ready"
        mock_db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_initializes_queue_with_project_path(self, mock_db):
        """Should include project path in queue."""
        prd_paths = ["prd1.md"]
        project_path = "/home/user/project"

        result = await init_queue(mock_db, prd_paths, project_path)

        assert result["project_path"] == project_path

    @pytest.mark.asyncio
    async def test_items_have_correct_structure(self, mock_db):
        """Should create items with all required fields."""
        prd_paths = ["prd1.md"]

        result = await init_queue(mock_db, prd_paths)

        item = result["items"][0]
        assert "id" in item
        assert "path" in item
        assert "status" in item
        assert item["pr_url"] is None
        assert item["branch"] is None
        assert item["started_at"] is None
        assert item["completed_at"] is None
        assert item["error"] is None


class TestGetNextPrd:
    """Tests for get_next_prd function."""

    @pytest.mark.asyncio
    async def test_returns_none_when_idle(self, mock_db):
        """Should return None when queue is idle."""
        mock_db.fetchrow.return_value = {"value_json": {"status": "idle", "items": []}}

        result = await get_next_prd(mock_db)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_no_pending(self, mock_db):
        """Should return None when no pending PRDs."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "done"}],
            "status": "ready",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await get_next_prd(mock_db)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_first_pending_prd(self, mock_db):
        """Should return first pending PRD with context."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "done"},
                {"id": 2, "path": "prd2.md", "status": "pending"},
            ],
            "status": "ready",
            "project_path": "/project",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await get_next_prd(mock_db)

        assert result["id"] == 2
        assert result["path"] == "prd2.md"
        assert result["project_path"] == "/project"
        assert result["total"] == 2
        assert result["completed"] == 1


class TestStartCurrentPrd:
    """Tests for start_current_prd function."""

    @pytest.mark.asyncio
    async def test_returns_error_when_no_pending(self, mock_db):
        """Should return error when no pending PRD."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "done"}],
            "status": "ready",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await start_current_prd(mock_db)

        assert result["success"] is False
        assert "No pending PRD" in result["error"]

    @pytest.mark.asyncio
    async def test_starts_first_pending_prd(self, mock_db):
        """Should start first pending PRD."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "pending"}],
            "status": "ready",
            "started_at": None,
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await start_current_prd(mock_db)

        assert result["success"] is True
        assert result["prd"]["status"] == "in_progress"
        assert result["prd"]["started_at"] is not None
        mock_db.execute.assert_called_once()


class TestCompletePrd:
    """Tests for complete_prd function."""

    @pytest.mark.asyncio
    async def test_returns_error_when_not_found(self, mock_db):
        """Should return error when PRD not found."""
        queue_data = {"items": [], "status": "ready"}
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await complete_prd(mock_db, 999)

        assert result["success"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_completes_prd(self, mock_db):
        """Should mark PRD as done."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "in_progress"}],
            "status": "running",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await complete_prd(mock_db, 1, pr_url="https://pr/1", branch="feature")

        assert result["success"] is True
        assert result["all_done"] is True
        mock_db.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_next_when_not_all_done(self, mock_db):
        """Should return next pending PRD."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "in_progress"},
                {"id": 2, "path": "prd2.md", "status": "pending"},
            ],
            "status": "running",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await complete_prd(mock_db, 1)

        assert result["success"] is True
        assert result["all_done"] is False
        assert result["next"]["id"] == 2


class TestFailPrd:
    """Tests for fail_prd function."""

    @pytest.mark.asyncio
    async def test_returns_error_when_not_found(self, mock_db):
        """Should return error when PRD not found."""
        queue_data = {"items": [], "status": "ready"}
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await fail_prd(mock_db, 999, "Error message")

        assert result["success"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_fails_prd_and_pauses_queue(self, mock_db):
        """Should mark PRD as failed and pause queue."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "in_progress"}],
            "status": "running",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await fail_prd(mock_db, 1, "Build failed")

        assert result["success"] is True
        assert result["paused"] is True
        mock_db.execute.assert_called_once()


class TestRetryFailed:
    """Tests for retry_failed function."""

    @pytest.mark.asyncio
    async def test_resets_failed_prds(self, mock_db):
        """Should reset failed PRDs to pending."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "failed", "error": "Error"},
                {"id": 2, "path": "prd2.md", "status": "done"},
            ],
            "status": "paused",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await retry_failed(mock_db)

        assert result["success"] is True
        mock_db.execute.assert_called_once()
        # Check the queue was updated with reset items
        call_args = mock_db.execute.call_args[0]
        updated_queue = json.loads(call_args[1])
        assert updated_queue["items"][0]["status"] == "pending"
        assert updated_queue["items"][0]["error"] is None
        assert updated_queue["status"] == "ready"


class TestClearQueue:
    """Tests for clear_queue function."""

    @pytest.mark.asyncio
    async def test_clears_queue(self, mock_db):
        """Should delete queue from working memory."""
        result = await clear_queue(mock_db)

        assert result["success"] is True
        mock_db.execute.assert_called_once()
        call_args = mock_db.execute.call_args[0]
        assert "DELETE" in call_args[0]
        assert PRD_QUEUE_KEY in call_args


class TestGetQueueSummary:
    """Tests for get_queue_summary function."""

    @pytest.mark.asyncio
    async def test_returns_none_when_idle(self, mock_db):
        """Should return None when queue is idle."""
        mock_db.fetchrow.return_value = {"value_json": {"status": "idle", "items": []}}

        result = await get_queue_summary(mock_db)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_summary_with_counts(self, mock_db):
        """Should return summary with status counts."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "done"},
                {"id": 2, "path": "prd2.md", "status": "in_progress"},
                {"id": 3, "path": "prd3.md", "status": "pending"},
                {"id": 4, "path": "prd4.md", "status": "failed"},
            ],
            "status": "running",
            "project_path": "/project",
            "started_at": "2024-01-01T00:00:00",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await get_queue_summary(mock_db)

        assert result["status"] == "running"
        assert result["total"] == 4
        assert result["pending"] == 1
        assert result["in_progress"] == 1
        assert result["done"] == 1
        assert result["failed"] == 1
        assert result["current"]["id"] == 2  # in_progress has priority
        assert result["project_path"] == "/project"

    @pytest.mark.asyncio
    async def test_returns_pending_as_current_when_no_in_progress(self, mock_db):
        """Should return first pending as current when no in_progress."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "done"},
                {"id": 2, "path": "prd2.md", "status": "pending"},
            ],
            "status": "ready",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        result = await get_queue_summary(mock_db)

        assert result["current"]["id"] == 2
