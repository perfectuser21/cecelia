"""Tests for Tick API endpoints."""

import json
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


class TestTickStatusEndpoint:
    """Tests for GET /api/brain/tick/status."""

    def test_returns_tick_status(self, client_with_db):
        """Returns tick status successfully."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/brain/tick/status")

        assert response.status_code == 200
        data = response.json()
        assert "enabled" in data
        assert "interval_minutes" in data
        assert data["interval_minutes"] == 30

    def test_returns_enabled_status(self, client_with_db):
        """Returns enabled status when tick is enabled."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = [
            {"key": "tick_enabled", "value_json": json.dumps({"enabled": True})},
        ]

        response = client.get("/api/brain/tick/status")

        assert response.status_code == 200
        assert response.json()["enabled"] is True


class TestTickEnableEndpoint:
    """Tests for POST /api/brain/tick/enable."""

    def test_enables_tick(self, client_with_db):
        """Enables tick successfully."""
        client, mock_db = client_with_db

        response = client.post("/api/brain/tick/enable")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["enabled"] is True


class TestTickDisableEndpoint:
    """Tests for POST /api/brain/tick/disable."""

    def test_disables_tick(self, client_with_db):
        """Disables tick successfully."""
        client, mock_db = client_with_db

        response = client.post("/api/brain/tick/disable")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["enabled"] is False


class TestTickExecuteEndpoint:
    """Tests for POST /api/brain/tick."""

    def test_executes_tick_no_focus(self, client_with_db):
        """Executes tick when no focus is set."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = None
        mock_db.fetch.return_value = []

        response = client.post("/api/brain/tick")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["actions_taken"] == []
        assert "No active Objective" in data.get("reason", "")

    def test_executes_tick_with_focus(self, client_with_db):
        """Executes tick with active focus."""
        client, mock_db = client_with_db
        # Mock focus exists
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
        mock_db.fetch.side_effect = [
            [],  # Key results
            [],  # Suggested tasks
            [],  # Tasks for tick (empty - no queued)
        ]

        response = client.post("/api/brain/tick")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "next_tick" in data
