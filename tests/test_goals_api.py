"""Tests for Goals API endpoints."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.state_routes import router as state_router, set_database


# Create a test app without the full lifespan
test_app = FastAPI()
test_app.include_router(state_router)


@pytest.fixture
def mock_db():
    """Create a mock database for testing."""
    db = MagicMock()
    db.fetchrow = AsyncMock()
    db.fetch = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def client_with_db(mock_db):
    """Create test client with mocked database."""
    set_database(mock_db)
    with TestClient(test_app, raise_server_exceptions=False) as client:
        yield client, mock_db
    set_database(None)


class TestListGoalsEndpoint:
    """Tests for GET /api/brain/goals."""

    def test_lists_objectives(self, client_with_db):
        """Lists all objectives."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = [
            {"id": "obj-1", "title": "Objective 1", "priority": "P0"},
            {"id": "obj-2", "title": "Objective 2", "priority": "P1"},
        ]

        response = client.get("/api/brain/goals")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    def test_filters_by_status(self, client_with_db):
        """Filters objectives by status."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/brain/goals?status=in_progress")

        assert response.status_code == 200

    def test_filters_by_priority(self, client_with_db):
        """Filters objectives by priority."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/brain/goals?priority=P0")

        assert response.status_code == 200


class TestGetGoalEndpoint:
    """Tests for GET /api/brain/goals/:id."""

    def test_returns_goal_details(self, client_with_db):
        """Returns goal with details."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {
            "id": "obj-1",
            "title": "Test Objective",
            "type": "objective",
            "status": "in_progress",
            "progress": 50,
        }
        mock_db.fetch.return_value = []  # No key results

        response = client.get("/api/brain/goals/obj-1")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "obj-1"
        assert data["title"] == "Test Objective"

    def test_returns_404_if_not_found(self, client_with_db):
        """Returns 404 if goal not found."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = None

        response = client.get("/api/brain/goals/nonexistent")

        assert response.status_code == 404

    def test_includes_tasks_when_requested(self, client_with_db):
        """Includes tasks when include_tasks=true."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {
            "id": "obj-1",
            "title": "Test",
            "type": "objective",
        }
        mock_db.fetch.side_effect = [
            [],  # Key results
            [{"id": "task-1", "title": "Task"}],  # Tasks
        ]

        response = client.get("/api/brain/goals/obj-1?include_tasks=true")

        assert response.status_code == 200
        data = response.json()
        assert "tasks" in data


class TestGetKeyResultsEndpoint:
    """Tests for GET /api/brain/goals/:id/key-results."""

    def test_returns_key_results(self, client_with_db):
        """Returns key results for objective."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = [
            {"id": "kr-1", "title": "KR 1", "progress": 30},
            {"id": "kr-2", "title": "KR 2", "progress": 60},
        ]

        response = client.get("/api/brain/goals/obj-1/key-results")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2


class TestDeleteGoalEndpoint:
    """Tests for DELETE /api/brain/goals/:id."""

    def test_deletes_goal(self, client_with_db):
        """Deletes a goal successfully."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {"id": "kr-1", "type": "key_result"}

        response = client.delete("/api/brain/goals/kr-1")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    def test_returns_400_if_has_children(self, client_with_db):
        """Returns 400 if objective has children."""
        client, mock_db = client_with_db
        mock_db.fetchrow.side_effect = [
            {"id": "obj-1", "type": "objective"},
            {"count": 2},  # Has children
        ]

        response = client.delete("/api/brain/goals/obj-1")

        assert response.status_code == 400

    def test_cascade_deletes_children(self, client_with_db):
        """Cascade deletes children when requested."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {"id": "obj-1", "type": "objective"}

        response = client.delete("/api/brain/goals/obj-1?cascade=true")

        assert response.status_code == 200


class TestRecalculateProgressEndpoint:
    """Tests for POST /api/brain/goals/:id/recalculate."""

    def test_recalculates_progress(self, client_with_db):
        """Recalculates objective progress."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = [
            {"progress": 100, "weight": 1},
            {"progress": 50, "weight": 1},
        ]

        response = client.post("/api/brain/goals/obj-1/recalculate")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["progress"] == 75

    def test_returns_zero_if_no_key_results(self, client_with_db):
        """Returns zero if no key results."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.post("/api/brain/goals/obj-1/recalculate")

        assert response.status_code == 200
        data = response.json()
        assert data["progress"] == 0


class TestGoalsSummaryEndpoint:
    """Tests for GET /api/brain/goals/summary."""

    def test_returns_summary(self, client_with_db):
        """Returns goals summary statistics."""
        client, mock_db = client_with_db
        mock_db.fetch.side_effect = [
            [{"status": "in_progress", "count": 3}],
            [{"status": "pending", "count": 5}],
        ]

        response = client.get("/api/brain/goals/summary")

        assert response.status_code == 200
        data = response.json()
        assert "objectives" in data
        assert "key_results" in data
