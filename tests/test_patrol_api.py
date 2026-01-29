"""Tests for Patrol API endpoints."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.patrol_routes import router as patrol_router, set_database


# Create a test app without the full lifespan
test_app = FastAPI()
test_app.include_router(patrol_router)


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


class TestGetStaleEndpoint:
    """Tests for GET /api/patrol/stale."""

    def test_returns_empty_list_when_no_stale_tasks(self, client_with_db):
        """Returns empty list when no stale tasks."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/patrol/stale")

        assert response.status_code == 200
        data = response.json()
        assert data["tasks"] == []
        assert data["total"] == 0
        assert data["threshold_minutes"] == 30

    def test_returns_stale_tasks(self, client_with_db):
        """Returns stale tasks."""
        client, mock_db = client_with_db
        task_id = uuid4()
        stale_time = datetime.now(timezone.utc) - timedelta(hours=1)
        mock_db.fetch.return_value = [
            {
                "id": task_id,
                "project": "test-project",
                "branch": "cp-test",
                "prd_path": ".prd.md",
                "status": "running",
                "current_step": 5,
                "pid": 12345,
                "started_at": stale_time,
                "updated_at": stale_time,
                "error": None,
                "pr_url": None,
            }
        ]

        response = client.get("/api/patrol/stale")

        assert response.status_code == 200
        data = response.json()
        assert len(data["tasks"]) == 1
        assert data["tasks"][0]["project"] == "test-project"
        assert data["total"] == 1

    def test_respects_threshold_parameter(self, client_with_db):
        """Uses custom threshold parameter."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/patrol/stale?threshold_minutes=60")

        assert response.status_code == 200
        data = response.json()
        assert data["threshold_minutes"] == 60

    def test_respects_limit_parameter(self, client_with_db):
        """Uses custom limit parameter."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/patrol/stale?limit=5")

        assert response.status_code == 200


class TestDiagnoseEndpoint:
    """Tests for POST /api/patrol/diagnose/:id."""

    def test_records_diagnosis(self, client_with_db):
        """Records diagnosis successfully."""
        client, mock_db = client_with_db
        task_id = str(uuid4())
        log_id = uuid4()

        mock_db.fetchrow.side_effect = [
            # Task exists
            {"id": task_id, "status": "running"},
            # Insert result
            {
                "id": log_id,
                "task_id": task_id,
                "diagnosis": "stuck_after_skill",
                "details": {"reason": "skill hang"},
                "created_at": datetime.now(timezone.utc),
            },
        ]

        response = client.post(
            f"/api/patrol/diagnose/{task_id}",
            json={
                "diagnosis": "stuck_after_skill",
                "details": {"reason": "skill hang"},
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["diagnosis"] == "stuck_after_skill"
        assert data["task_id"] == task_id

    def test_rejects_invalid_diagnosis(self, client_with_db):
        """Rejects invalid diagnosis type."""
        client, mock_db = client_with_db
        task_id = str(uuid4())

        response = client.post(
            f"/api/patrol/diagnose/{task_id}",
            json={"diagnosis": "invalid_type"},
        )

        assert response.status_code == 400
        assert "Invalid diagnosis" in response.json()["detail"]

    def test_returns_404_for_missing_task(self, client_with_db):
        """Returns 404 if task not found."""
        client, mock_db = client_with_db
        task_id = str(uuid4())
        mock_db.fetchrow.return_value = None

        response = client.post(
            f"/api/patrol/diagnose/{task_id}",
            json={"diagnosis": "normal"},
        )

        assert response.status_code == 404


class TestActionEndpoint:
    """Tests for POST /api/patrol/action/:id."""

    def test_records_action(self, client_with_db):
        """Records action successfully."""
        client, mock_db = client_with_db
        task_id = str(uuid4())
        log_id = uuid4()

        mock_db.fetchrow.side_effect = [
            # Task exists
            {"id": task_id, "status": "running"},
            # Insert result
            {
                "id": log_id,
                "task_id": task_id,
                "action": "restart",
                "action_result": "success",
                "details": {"new_pid": 54321},
                "created_at": datetime.now(timezone.utc),
            },
        ]

        response = client.post(
            f"/api/patrol/action/{task_id}",
            json={
                "action": "restart",
                "action_result": "success",
                "details": {"new_pid": 54321},
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["action"] == "restart"
        assert data["action_result"] == "success"

    def test_rejects_invalid_action(self, client_with_db):
        """Rejects invalid action type."""
        client, mock_db = client_with_db
        task_id = str(uuid4())

        response = client.post(
            f"/api/patrol/action/{task_id}",
            json={
                "action": "invalid_action",
                "action_result": "success",
            },
        )

        assert response.status_code == 400
        assert "Invalid action" in response.json()["detail"]

    def test_rejects_invalid_result(self, client_with_db):
        """Rejects invalid action result."""
        client, mock_db = client_with_db
        task_id = str(uuid4())

        response = client.post(
            f"/api/patrol/action/{task_id}",
            json={
                "action": "restart",
                "action_result": "invalid_result",
            },
        )

        assert response.status_code == 400
        assert "Invalid action_result" in response.json()["detail"]

    def test_returns_404_for_missing_task(self, client_with_db):
        """Returns 404 if task not found."""
        client, mock_db = client_with_db
        task_id = str(uuid4())
        mock_db.fetchrow.return_value = None

        response = client.post(
            f"/api/patrol/action/{task_id}",
            json={
                "action": "restart",
                "action_result": "success",
            },
        )

        assert response.status_code == 404


class TestLogsEndpoint:
    """Tests for GET /api/patrol/logs."""

    def test_returns_logs(self, client_with_db):
        """Returns patrol logs."""
        client, mock_db = client_with_db
        log_id = uuid4()
        task_id = uuid4()
        mock_db.fetch.return_value = [
            {
                "id": log_id,
                "task_id": task_id,
                "diagnosis": "stuck_after_skill",
                "action": "restart",
                "action_result": "success",
                "details": {},
                "created_at": datetime.now(timezone.utc),
            }
        ]

        response = client.get("/api/patrol/logs")

        assert response.status_code == 200
        data = response.json()
        assert len(data["logs"]) == 1
        assert data["logs"][0]["diagnosis"] == "stuck_after_skill"

    def test_filters_by_task_id(self, client_with_db):
        """Filters logs by task ID."""
        client, mock_db = client_with_db
        task_id = str(uuid4())
        mock_db.fetch.return_value = []

        response = client.get(f"/api/patrol/logs?task_id={task_id}")

        assert response.status_code == 200

    def test_filters_by_diagnosis(self, client_with_db):
        """Filters logs by diagnosis type."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/patrol/logs?diagnosis=ci_timeout")

        assert response.status_code == 200

    def test_respects_pagination(self, client_with_db):
        """Uses limit and offset parameters."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/patrol/logs?limit=10&offset=5")

        assert response.status_code == 200


class TestSummaryEndpoint:
    """Tests for GET /api/patrol/summary."""

    def test_returns_summary(self, client_with_db):
        """Returns patrol summary statistics."""
        client, mock_db = client_with_db
        mock_db.fetch.side_effect = [
            # Diagnoses
            [
                {"diagnosis": "stuck_after_skill", "count": 3},
                {"diagnosis": "normal", "count": 10},
            ],
            # Actions
            [
                {"action_result": "success", "count": 8},
                {"action_result": "failed", "count": 2},
            ],
            # Stale tasks
            [],
        ]

        response = client.get("/api/patrol/summary")

        assert response.status_code == 200
        data = response.json()
        assert "stale_task_count" in data
        assert "diagnoses_24h" in data
        assert "actions_24h" in data
        assert "last_patrol" in data

    def test_handles_empty_data(self, client_with_db):
        """Handles case with no data."""
        client, mock_db = client_with_db
        mock_db.fetch.side_effect = [[], [], []]

        response = client.get("/api/patrol/summary")

        assert response.status_code == 200
        data = response.json()
        assert data["stale_task_count"] == 0
        assert data["diagnoses_24h"] == {}
        assert data["actions_24h"] == {}


class TestDatabaseNotInitialized:
    """Tests for database not initialized error."""

    def test_stale_returns_503(self):
        """GET /api/patrol/stale returns 503 when db not initialized."""
        set_database(None)
        with TestClient(test_app, raise_server_exceptions=False) as client:
            response = client.get("/api/patrol/stale")
            assert response.status_code == 503

    def test_diagnose_returns_503(self):
        """POST /api/patrol/diagnose returns 503 when db not initialized."""
        set_database(None)
        with TestClient(test_app, raise_server_exceptions=False) as client:
            response = client.post(
                f"/api/patrol/diagnose/{uuid4()}",
                json={"diagnosis": "normal"},
            )
            assert response.status_code == 503

    def test_action_returns_503(self):
        """POST /api/patrol/action returns 503 when db not initialized."""
        set_database(None)
        with TestClient(test_app, raise_server_exceptions=False) as client:
            response = client.post(
                f"/api/patrol/action/{uuid4()}",
                json={"action": "none", "action_result": "skipped"},
            )
            assert response.status_code == 503

    def test_logs_returns_503(self):
        """GET /api/patrol/logs returns 503 when db not initialized."""
        set_database(None)
        with TestClient(test_app, raise_server_exceptions=False) as client:
            response = client.get("/api/patrol/logs")
            assert response.status_code == 503

    def test_summary_returns_503(self):
        """GET /api/patrol/summary returns 503 when db not initialized."""
        set_database(None)
        with TestClient(test_app, raise_server_exceptions=False) as client:
            response = client.get("/api/patrol/summary")
            assert response.status_code == 503
