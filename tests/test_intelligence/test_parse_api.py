"""Tests for /parse API endpoint."""

import pytest
from fastapi.testclient import TestClient

from src.api.main import app


@pytest.fixture
def client():
    """Create test client."""
    with TestClient(app) as c:
        yield c


class TestParseAPI:
    """Test suite for /parse API endpoint."""

    def test_parse_simple_intent(self, client):
        """Test parsing a simple intent."""
        response = client.post(
            "/parse",
            json={"intent": "Add user login feature"},
        )
        assert response.status_code == 200

        data = response.json()
        assert "understanding" in data
        assert "tasks" in data
        assert "dependency_graph" in data
        assert "parse_time_ms" in data

    def test_parse_returns_understanding(self, client):
        """Test that parse returns understanding section."""
        response = client.post(
            "/parse",
            json={"intent": "Implement authentication system"},
        )
        assert response.status_code == 200

        understanding = response.json()["understanding"]
        assert "type" in understanding
        assert "scope" in understanding
        assert "description" in understanding
        assert "keywords" in understanding
        assert "estimated_complexity" in understanding

    def test_parse_returns_tasks(self, client):
        """Test that parse returns tasks list."""
        response = client.post(
            "/parse",
            json={"intent": "Create REST API endpoint"},
        )
        assert response.status_code == 200

        tasks = response.json()["tasks"]
        assert isinstance(tasks, list)
        assert len(tasks) >= 3

        # Check task structure
        for task in tasks:
            assert "id" in task
            assert "title" in task
            assert "description" in task
            assert "priority" in task
            assert "estimated_time" in task
            assert "dependencies" in task
            assert "tags" in task

    def test_parse_returns_dependency_graph(self, client):
        """Test that parse returns dependency graph."""
        response = client.post(
            "/parse",
            json={"intent": "Build frontend component"},
        )
        assert response.status_code == 200

        dep_graph = response.json()["dependency_graph"]
        assert "graph" in dep_graph
        assert "execution_order" in dep_graph
        assert "parallel_groups" in dep_graph

    def test_parse_with_context(self, client):
        """Test parsing with context."""
        response = client.post(
            "/parse",
            json={
                "intent": "Add login feature",
                "context": {
                    "project": "cecelia-workspace",
                    "current_branch": "develop",
                },
            },
        )
        assert response.status_code == 200

    def test_parse_without_history(self, client):
        """Test parsing without historical context."""
        response = client.post(
            "/parse",
            json={
                "intent": "Add feature",
                "use_history": False,
            },
        )
        assert response.status_code == 200

        data = response.json()
        # Without history, historical_context should be empty
        assert data["historical_context"] == []

    def test_parse_empty_intent_fails(self, client):
        """Test that empty intent returns error."""
        response = client.post(
            "/parse",
            json={"intent": ""},
        )
        assert response.status_code == 400

    def test_parse_whitespace_intent_fails(self, client):
        """Test that whitespace-only intent returns error."""
        response = client.post(
            "/parse",
            json={"intent": "   "},
        )
        assert response.status_code == 400

    def test_parse_chinese_intent(self, client):
        """Test parsing Chinese intent."""
        response = client.post(
            "/parse",
            json={"intent": "实现用户登录功能"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["understanding"]["type"] == "feature"

    def test_parse_fix_intent(self, client):
        """Test parsing fix intent."""
        response = client.post(
            "/parse",
            json={"intent": "Fix the bug in login form"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["understanding"]["type"] == "fix"

    def test_parse_refactor_intent(self, client):
        """Test parsing refactor intent."""
        response = client.post(
            "/parse",
            json={"intent": "Refactor the authentication module"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["understanding"]["type"] == "refactor"

    def test_parse_time_is_reasonable(self, client):
        """Test that parse time is reasonable."""
        response = client.post(
            "/parse",
            json={"intent": "Add user login feature"},
        )
        assert response.status_code == 200

        parse_time = response.json()["parse_time_ms"]
        # Should complete in under 1 second
        assert parse_time < 1000

    def test_task_ids_are_unique(self, client):
        """Test that all task IDs are unique."""
        response = client.post(
            "/parse",
            json={"intent": "Build complete authentication system"},
        )
        assert response.status_code == 200

        tasks = response.json()["tasks"]
        ids = [t["id"] for t in tasks]
        assert len(ids) == len(set(ids))
