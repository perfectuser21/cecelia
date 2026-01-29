"""Tests for Queue API endpoints."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.state_routes import router, set_database


@pytest.fixture
def mock_db():
    """Create mock database."""
    db = MagicMock()
    db.fetchrow = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def client(mock_db):
    """Create test client with mock database."""
    app = FastAPI()
    app.include_router(router)
    set_database(mock_db)
    return TestClient(app)


class TestGetQueueEndpoint:
    """Tests for GET /api/brain/queue endpoint."""

    def test_returns_empty_queue(self, client, mock_db):
        """Should return empty queue state."""
        mock_db.fetchrow.return_value = None

        response = client.get("/api/brain/queue")

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["current_index"] == -1
        assert data["status"] == "idle"

    def test_returns_queue_with_items(self, client, mock_db):
        """Should return queue with items."""
        queue_data = {
            "items": [
                {"id": 1, "path": "prd1.md", "status": "pending"},
                {"id": 2, "path": "prd2.md", "status": "done"},
            ],
            "current_index": 0,
            "status": "ready",
            "project_path": "/project",
            "started_at": None,
            "updated_at": "2024-01-01T00:00:00",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.get("/api/brain/queue")

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["status"] == "ready"


class TestInitQueueEndpoint:
    """Tests for POST /api/brain/queue/init endpoint."""

    def test_initializes_queue(self, client, mock_db):
        """Should initialize queue with PRD paths."""
        response = client.post(
            "/api/brain/queue/init",
            json={"prd_paths": ["prd1.md", "prd2.md"], "project_path": "/project"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["status"] == "ready"
        assert data["project_path"] == "/project"

    def test_initializes_without_project_path(self, client, mock_db):
        """Should initialize queue without project path."""
        response = client.post(
            "/api/brain/queue/init",
            json={"prd_paths": ["prd1.md"]},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1


class TestGetNextPrdEndpoint:
    """Tests for GET /api/brain/queue/next endpoint."""

    def test_returns_null_when_idle(self, client, mock_db):
        """Should return null when queue is idle."""
        mock_db.fetchrow.return_value = {"value_json": {"status": "idle", "items": []}}

        response = client.get("/api/brain/queue/next")

        assert response.status_code == 200
        assert response.json() is None

    def test_returns_next_prd(self, client, mock_db):
        """Should return next pending PRD."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "pending"}],
            "status": "ready",
            "project_path": "/project",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.get("/api/brain/queue/next")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == 1
        assert data["total"] == 1
        assert data["completed"] == 0


class TestStartPrdEndpoint:
    """Tests for POST /api/brain/queue/start endpoint."""

    def test_returns_error_when_no_pending(self, client, mock_db):
        """Should return error when no pending PRD."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "done"}],
            "status": "ready",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post("/api/brain/queue/start")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "No pending" in data["error"]

    def test_starts_prd(self, client, mock_db):
        """Should start pending PRD."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "pending"}],
            "status": "ready",
            "started_at": None,
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post("/api/brain/queue/start")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["prd"]["status"] == "in_progress"


class TestCompletePrdEndpoint:
    """Tests for POST /api/brain/queue/complete endpoint."""

    def test_returns_error_when_not_found(self, client, mock_db):
        """Should return error when PRD not found."""
        queue_data = {"items": [], "status": "ready"}
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post(
            "/api/brain/queue/complete",
            json={"prd_id": 999},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False

    def test_completes_prd(self, client, mock_db):
        """Should complete PRD."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "in_progress"}],
            "status": "running",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post(
            "/api/brain/queue/complete",
            json={"prd_id": 1, "pr_url": "https://pr/1", "branch": "feature"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["all_done"] is True


class TestFailPrdEndpoint:
    """Tests for POST /api/brain/queue/fail endpoint."""

    def test_returns_error_when_not_found(self, client, mock_db):
        """Should return error when PRD not found."""
        queue_data = {"items": [], "status": "ready"}
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post(
            "/api/brain/queue/fail",
            json={"prd_id": 999, "error": "Error"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False

    def test_fails_prd(self, client, mock_db):
        """Should fail PRD and pause queue."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "in_progress"}],
            "status": "running",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post(
            "/api/brain/queue/fail",
            json={"prd_id": 1, "error": "Build failed"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["paused"] is True


class TestRetryFailedEndpoint:
    """Tests for POST /api/brain/queue/retry endpoint."""

    def test_retries_failed_prds(self, client, mock_db):
        """Should retry failed PRDs."""
        queue_data = {
            "items": [{"id": 1, "path": "prd1.md", "status": "failed", "error": "Err"}],
            "status": "paused",
        }
        mock_db.fetchrow.return_value = {"value_json": queue_data}

        response = client.post("/api/brain/queue/retry")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True


class TestClearQueueEndpoint:
    """Tests for DELETE /api/brain/queue endpoint."""

    def test_clears_queue(self, client, mock_db):
        """Should clear queue."""
        response = client.delete("/api/brain/queue")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_db.execute.assert_called_once()


class TestGetQueueSummaryEndpoint:
    """Tests for GET /api/brain/queue/summary endpoint."""

    def test_returns_null_when_idle(self, client, mock_db):
        """Should return null when queue is idle."""
        mock_db.fetchrow.return_value = {"value_json": {"status": "idle", "items": []}}

        response = client.get("/api/brain/queue/summary")

        assert response.status_code == 200
        assert response.json() is None

    def test_returns_summary(self, client, mock_db):
        """Should return queue summary."""
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

        response = client.get("/api/brain/queue/summary")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert data["total"] == 3
        assert data["done"] == 1
        assert data["in_progress"] == 1
        assert data["pending"] == 1
        assert data["current"]["id"] == 2
