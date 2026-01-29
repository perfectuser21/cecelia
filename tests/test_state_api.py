"""Tests for State API routes."""

import pytest
from unittest.mock import AsyncMock, MagicMock

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


class TestGetFocusEndpoint:
    """Tests for GET /api/brain/focus endpoint."""

    def test_get_focus_success(self, client_with_db):
        """Should return focus when available."""
        client, mock_db = client_with_db

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

        response = client.get("/api/brain/focus")

        assert response.status_code == 200
        data = response.json()
        assert data["focus"]["objective"]["id"] == "obj-1"
        assert data["is_manual"] is False

    def test_get_focus_not_found(self, client_with_db):
        """Should return 404 when no focus available."""
        client, mock_db = client_with_db

        mock_db.fetchrow.side_effect = [None, None]

        response = client.get("/api/brain/focus")

        assert response.status_code == 404

    def test_get_focus_no_db(self):
        """Should return 503 when database not initialized."""
        set_database(None)

        with TestClient(test_app, raise_server_exceptions=False) as client:
            response = client.get("/api/brain/focus")

        assert response.status_code == 503


class TestGetFocusSummaryEndpoint:
    """Tests for GET /api/brain/focus/summary endpoint."""

    def test_get_summary_success(self, client_with_db):
        """Should return focus summary."""
        client, mock_db = client_with_db

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

        response = client.get("/api/brain/focus/summary")

        assert response.status_code == 200
        data = response.json()
        assert data["objective_id"] == "obj-1"
        assert data["priority"] == "P0"


class TestSetFocusEndpoint:
    """Tests for POST /api/brain/focus/set endpoint."""

    def test_set_focus_success(self, client_with_db):
        """Should set focus successfully."""
        client, mock_db = client_with_db

        mock_db.fetchrow.return_value = {"id": "obj-123"}

        response = client.post(
            "/api/brain/focus/set",
            json={"objective_id": "obj-123"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["objective_id"] == "obj-123"

    def test_set_focus_not_found(self, client_with_db):
        """Should return 404 when objective not found."""
        client, mock_db = client_with_db

        mock_db.fetchrow.return_value = None

        response = client.post(
            "/api/brain/focus/set",
            json={"objective_id": "nonexistent"},
        )

        assert response.status_code == 404


class TestClearFocusEndpoint:
    """Tests for POST /api/brain/focus/clear endpoint."""

    def test_clear_focus_success(self, client_with_db):
        """Should clear focus successfully."""
        client, mock_db = client_with_db

        response = client.post("/api/brain/focus/clear")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_db.execute.assert_called_once()
