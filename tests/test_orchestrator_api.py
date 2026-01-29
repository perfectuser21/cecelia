"""Tests for Orchestrator API routes."""

import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.orchestrator_routes import router as orchestrator_router


# Create a test app
test_app = FastAPI()
test_app.include_router(orchestrator_router)


@pytest.fixture
def client():
    """Create test client."""
    with TestClient(test_app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def mock_state_file(tmp_path):
    """Create a mock state.json file."""
    state = {
        "_meta": {
            "version": "1.0.0",
            "updated_at": "2026-01-29T00:00:00Z",
            "updated_by": "test",
            "host": "test-host"
        },
        "focus": {
            "project_key": "test-project",
            "repo_path": "/tmp/test",
            "branch": "main",
            "intent": "testing",
            "task_ref": None
        },
        "sessions": {},
        "work": {
            "active_runs": [],
            "queue": [],
            "locks": {"orchestrator_lock": None}
        },
        "memory": {
            "recent_decisions": [],
            "pointers": {
                "last_error_log": None,
                "last_run_report": None
            },
            "summaries": {"latest": str(tmp_path / "latest.md")}
        }
    }
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps(state))
    return state_file, state


class TestOrchestratorHealth:
    """Tests for GET /orchestrator/health endpoint."""

    def test_health_returns_status(self, client):
        """Should return health status."""
        response = client.get("/orchestrator/health")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "status" in data
        assert "checks" in data
        assert "paths" in data


class TestOrchestratorState:
    """Tests for GET /orchestrator/state endpoint."""

    def test_get_state_not_found(self, client):
        """Should return 404 when state.json missing."""
        with patch('src.api.orchestrator_routes.STATE_FILE', Path('/nonexistent')):
            response = client.get("/orchestrator/state")
            assert response.status_code == 404

    def test_get_state_success(self, client, mock_state_file):
        """Should return state when file exists."""
        state_file, expected_state = mock_state_file
        with patch('src.api.orchestrator_routes.STATE_FILE', state_file):
            response = client.get("/orchestrator/state")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["state"]["focus"]["project_key"] == "test-project"


class TestOrchestratorFocus:
    """Tests for POST /orchestrator/focus endpoint."""

    def test_update_focus_not_found(self, client):
        """Should return 404 when state.json missing."""
        with patch('src.api.orchestrator_routes.STATE_FILE', Path('/nonexistent')):
            response = client.post(
                "/orchestrator/focus",
                json={"intent": "new intent"}
            )
            assert response.status_code == 404

    def test_update_focus_success(self, client, mock_state_file, tmp_path):
        """Should update focus successfully."""
        state_file, _ = mock_state_file
        with patch('src.api.orchestrator_routes.STATE_FILE', state_file):
            with patch('src.api.orchestrator_routes.RUNTIME_DIR', tmp_path):
                response = client.post(
                    "/orchestrator/focus",
                    json={"intent": "new intent"}
                )
                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["focus"]["intent"] == "new intent"


class TestOrchestratorDecide:
    """Tests for POST /orchestrator/decide endpoint."""

    def test_add_decision_success(self, client, mock_state_file, tmp_path):
        """Should add decision successfully."""
        state_file, _ = mock_state_file
        with patch('src.api.orchestrator_routes.STATE_FILE', state_file):
            with patch('src.api.orchestrator_routes.RUNTIME_DIR', tmp_path):
                response = client.post(
                    "/orchestrator/decide",
                    json={
                        "decision": "Use SQLite",
                        "reason": "Simple enough",
                        "context": "Storage discussion"
                    }
                )
                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["decision"]["decision"] == "Use SQLite"


class TestOrchestratorFull:
    """Tests for GET /orchestrator endpoint."""

    def test_get_full_orchestrator(self, client, mock_state_file):
        """Should return full orchestrator status."""
        state_file, _ = mock_state_file
        with patch('src.api.orchestrator_routes.STATE_FILE', state_file):
            with patch('src.api.orchestrator_routes.get_warmup', return_value="warmup output"):
                response = client.get("/orchestrator")
                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert "state" in data
                assert "warmup" in data
