"""Tests for Actions API endpoints."""

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


class TestActionEndpoint:
    """Tests for POST /api/brain/action/{action_name}."""

    def test_create_task_action(self, client_with_db):
        """Executes create-task action."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "New Task",
            "description": "Task description",
            "priority": "P1",
            "project_id": None,
            "goal_id": None,
            "tags": [],
            "status": "queued",
        }

        response = client.post(
            "/api/brain/action/create-task",
            json={"params": {"title": "New Task", "description": "Task description"}},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["task"]["title"] == "New Task"

    def test_update_task_action(self, client_with_db):
        """Executes update-task action."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {
            "id": "task-123",
            "title": "Test Task",
            "status": "in_progress",
            "priority": "P1",
        }

        response = client.post(
            "/api/brain/action/update-task",
            json={"params": {"task_id": "task-123", "status": "in_progress"}},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["task"]["status"] == "in_progress"

    def test_create_goal_action(self, client_with_db):
        """Executes create-goal action."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {
            "id": "goal-123",
            "title": "New Goal",
            "description": "",
            "priority": "P0",
            "project_id": None,
            "target_date": None,
            "type": "objective",
            "parent_id": None,
            "status": "pending",
            "progress": 0,
        }

        response = client.post(
            "/api/brain/action/create-goal",
            json={"params": {"title": "New Goal", "priority": "P0"}},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["goal"]["title"] == "New Goal"

    def test_update_goal_action(self, client_with_db):
        """Executes update-goal action."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = {
            "id": "goal-123",
            "title": "Test Goal",
            "status": "in_progress",
            "progress": 50,
        }

        response = client.post(
            "/api/brain/action/update-goal",
            json={"params": {"goal_id": "goal-123", "progress": 50}},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["goal"]["progress"] == 50

    def test_set_memory_action(self, client_with_db):
        """Executes set-memory action."""
        client, mock_db = client_with_db

        response = client.post(
            "/api/brain/action/set-memory",
            json={"params": {"key": "test_key", "value": "test_value"}},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["key"] == "test_key"
        assert data["value"] == "test_value"

    def test_batch_update_tasks_action(self, client_with_db):
        """Executes batch-update-tasks action."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = [{"id": "task-1"}, {"id": "task-2"}]

        response = client.post(
            "/api/brain/action/batch-update-tasks",
            json={
                "params": {
                    "filter_criteria": {"status": "queued"},
                    "update_values": {"status": "paused"},
                }
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["count"] == 2

    def test_unknown_action_returns_400(self, client_with_db):
        """Returns 400 for unknown action."""
        client, mock_db = client_with_db

        response = client.post(
            "/api/brain/action/unknown-action",
            json={"params": {}},
        )

        assert response.status_code == 400
        assert "Unknown action" in response.json()["detail"]
