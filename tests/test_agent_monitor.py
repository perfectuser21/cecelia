"""Tests for Agent Monitor module and API endpoints."""

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.agent_routes import router as agent_router, set_database
from src.state.agent_monitor import (
    parse_output_line,
    EVENT_USER_MESSAGE,
    EVENT_TOOL_USE,
    EVENT_TOOL_RESULT,
    EVENT_TEXT,
    EVENT_HOOK_PROGRESS,
)


# Create a test app without the full lifespan
test_app = FastAPI()
test_app.include_router(agent_router)


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


class TestParseOutputLine:
    """Tests for parse_output_line function."""

    def test_parse_user_message_string(self):
        """Parse user message with string content."""
        line = json.dumps({
            "type": "user",
            "message": {"role": "user", "content": "Hello world"},
            "agentId": "test123",
            "sessionId": "sess456",
            "uuid": "uuid789",
            "timestamp": "2026-01-29T10:00:00Z",
            "cwd": "/home/test",
        })

        result = parse_output_line(line)

        assert result is not None
        event_type, payload, metadata = result
        assert event_type == EVENT_USER_MESSAGE
        assert payload["content"] == "Hello world"
        assert metadata["agent_id"] == "test123"

    def test_parse_tool_result(self):
        """Parse tool result event."""
        line = json.dumps({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool123",
                    "content": "Command output",
                    "is_error": False,
                }]
            },
            "agentId": "test123",
            "timestamp": "2026-01-29T10:00:00Z",
        })

        result = parse_output_line(line)

        assert result is not None
        event_type, payload, metadata = result
        assert event_type == EVENT_TOOL_RESULT
        assert payload["tool_use_id"] == "tool123"
        assert payload["content"] == "Command output"
        assert payload["is_error"] is False

    def test_parse_tool_use(self):
        """Parse tool use event."""
        line = json.dumps({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": "tool123",
                    "name": "Bash",
                    "input": {"command": "ls -la"},
                }]
            },
            "agentId": "test123",
            "timestamp": "2026-01-29T10:00:00Z",
        })

        result = parse_output_line(line)

        assert result is not None
        event_type, payload, metadata = result
        assert event_type == EVENT_TOOL_USE
        assert payload["id"] == "tool123"
        assert payload["name"] == "Bash"
        assert payload["input"] == {"command": "ls -la"}

    def test_parse_text_response(self):
        """Parse assistant text response."""
        line = json.dumps({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{
                    "type": "text",
                    "text": "I will help you with that.",
                }]
            },
            "agentId": "test123",
            "timestamp": "2026-01-29T10:00:00Z",
        })

        result = parse_output_line(line)

        assert result is not None
        event_type, payload, metadata = result
        assert event_type == EVENT_TEXT
        assert payload["text"] == "I will help you with that."

    def test_parse_hook_progress(self):
        """Parse hook progress event."""
        line = json.dumps({
            "type": "progress",
            "data": {
                "type": "hook_progress",
                "hookEvent": "PreToolUse",
                "hookName": "PreToolUse:Bash",
                "command": "/path/to/hook.sh",
            },
            "agentId": "test123",
            "timestamp": "2026-01-29T10:00:00Z",
        })

        result = parse_output_line(line)

        assert result is not None
        event_type, payload, metadata = result
        assert event_type == EVENT_HOOK_PROGRESS
        assert payload["hook_event"] == "PreToolUse"
        assert payload["hook_name"] == "PreToolUse:Bash"

    def test_parse_empty_line(self):
        """Empty line returns None."""
        result = parse_output_line("")
        assert result is None

        result = parse_output_line("   ")
        assert result is None

    def test_parse_invalid_json(self):
        """Invalid JSON returns None."""
        result = parse_output_line("not valid json")
        assert result is None

    def test_parse_unknown_type(self):
        """Unknown message type returns None."""
        line = json.dumps({
            "type": "unknown",
            "message": {},
            "agentId": "test123",
        })
        result = parse_output_line(line)
        assert result is None


class TestListRunsEndpoint:
    """Tests for GET /api/agents/runs."""

    def test_returns_empty_list(self, client_with_db):
        """Returns empty list when no runs."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/agents/runs")

        assert response.status_code == 200
        data = response.json()
        assert data["runs"] == []
        assert data["total"] == 0

    def test_returns_runs(self, client_with_db):
        """Returns list of runs."""
        client, mock_db = client_with_db
        run_id = uuid4()
        now = datetime.now(timezone.utc)
        mock_db.fetch.return_value = [
            {
                "id": run_id,
                "agent_id": "a123456",
                "output_file": "/tmp/claude/tasks/a123456.output",
                "project": "/home/test/project",
                "source": "claude_code",
                "status": "running",
                "current_tool": "Bash",
                "last_result": "Success",
                "last_seq": 10,
                "turn_count": 3,
                "last_heartbeat_at": now,
                "started_at": now,
                "updated_at": now,
                "completed_at": None,
                "cecelia_run_id": None,
            }
        ]

        response = client.get("/api/agents/runs")

        assert response.status_code == 200
        data = response.json()
        assert len(data["runs"]) == 1
        assert data["runs"][0]["agent_id"] == "a123456"
        assert data["runs"][0]["current_tool"] == "Bash"

    def test_filter_by_status(self, client_with_db):
        """Filter runs by status."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/agents/runs?status=running")

        assert response.status_code == 200
        mock_db.fetch.assert_called_once()

    def test_invalid_status_returns_400(self, client_with_db):
        """Invalid status returns 400."""
        client, _ = client_with_db

        response = client.get("/api/agents/runs?status=invalid")

        assert response.status_code == 400
        assert "Invalid status" in response.json()["detail"]


class TestGetRunDetailEndpoint:
    """Tests for GET /api/agents/runs/:id."""

    def test_returns_run_detail(self, client_with_db):
        """Returns run details."""
        client, mock_db = client_with_db
        run_id = uuid4()
        now = datetime.now(timezone.utc)
        mock_db.fetchrow.return_value = {
            "id": run_id,
            "agent_id": "a123456",
            "output_file": "/tmp/claude/tasks/a123456.output",
            "project": "/home/test/project",
            "source": "claude_code",
            "status": "running",
            "current_tool": "Read",
            "last_result": None,
            "last_seq": 5,
            "turn_count": 2,
            "last_heartbeat_at": now,
            "started_at": now,
            "updated_at": now,
            "completed_at": None,
            "cecelia_run_id": None,
        }

        response = client.get(f"/api/agents/runs/{run_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["agent_id"] == "a123456"
        assert data["current_tool"] == "Read"

    def test_run_not_found(self, client_with_db):
        """Returns 404 when run not found."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = None

        response = client.get(f"/api/agents/runs/{uuid4()}")

        assert response.status_code == 404


class TestGetRunEventsEndpoint:
    """Tests for GET /api/agents/runs/:id/events."""

    def test_returns_events(self, client_with_db):
        """Returns events for a run."""
        client, mock_db = client_with_db
        run_id = uuid4()
        event_id = uuid4()
        now = datetime.now(timezone.utc)

        mock_db.fetchrow.return_value = {
            "id": run_id,
            "agent_id": "a123456",
            "output_file": "/tmp/test.output",
            "project": None,
            "source": "claude_code",
            "status": "running",
            "current_tool": None,
            "last_result": None,
            "last_seq": 0,
            "turn_count": 0,
            "last_heartbeat_at": now,
            "started_at": now,
            "updated_at": now,
            "completed_at": None,
            "cecelia_run_id": None,
        }

        mock_db.fetch.return_value = [
            {
                "id": event_id,
                "run_id": run_id,
                "seq": 1,
                "type": "tool_use",
                "tool_name": "Bash",
                "payload": json.dumps({"name": "Bash", "input": {"command": "ls"}}),
                "created_at": now,
            }
        ]

        response = client.get(f"/api/agents/runs/{run_id}/events")

        assert response.status_code == 200
        data = response.json()
        assert len(data["events"]) == 1
        assert data["events"][0]["type"] == "tool_use"
        assert data["events"][0]["tool_name"] == "Bash"
        assert data["last_seq"] == 1

    def test_run_not_found(self, client_with_db):
        """Returns 404 when run not found."""
        client, mock_db = client_with_db
        mock_db.fetchrow.return_value = None

        response = client.get(f"/api/agents/runs/{uuid4()}/events")

        assert response.status_code == 404


class TestActiveRunsEndpoint:
    """Tests for GET /api/agents/runs/active."""

    def test_returns_active_runs(self, client_with_db):
        """Returns only active runs."""
        client, mock_db = client_with_db
        mock_db.fetch.return_value = []

        response = client.get("/api/agents/runs/active")

        assert response.status_code == 200
        data = response.json()
        assert data["runs"] == []


class TestRunsSummaryEndpoint:
    """Tests for GET /api/agents/runs/summary."""

    def test_returns_summary(self, client_with_db):
        """Returns summary statistics."""
        client, mock_db = client_with_db

        mock_db.fetch.side_effect = [
            [
                {"status": "running", "count": 2},
                {"status": "completed", "count": 5},
            ],
            [],
        ]

        response = client.get("/api/agents/runs/summary")

        assert response.status_code == 200
        data = response.json()
        assert data["by_status"]["running"] == 2
        assert data["by_status"]["completed"] == 5
        assert data["total"] == 7
