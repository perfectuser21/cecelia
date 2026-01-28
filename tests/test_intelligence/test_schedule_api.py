"""Tests for /schedule API endpoint."""

import pytest
from fastapi.testclient import TestClient

from src.api.main import app


@pytest.fixture
def client():
    """Create test client."""
    with TestClient(app) as c:
        yield c


class TestScheduleAPI:
    """Test suite for /schedule API endpoint."""

    def test_schedule_simple_tasks(self, client):
        """Test scheduling simple tasks."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": ["task-1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "execution_plan" in data
        assert "visualization" in data
        assert "schedule_time_ms" in data

    def test_schedule_returns_phases(self, client):
        """Test that schedule returns phases."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": ["task-1"]},
                    {"id": "task-3", "priority": "P0", "dependencies": ["task-2"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        phases = data["execution_plan"]["phases"]
        assert len(phases) >= 1
        assert all("phase" in p for p in phases)
        assert all("tasks" in p for p in phases)

    def test_schedule_returns_critical_path(self, client):
        """Test that schedule returns critical path."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": ["task-1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "critical_path" in data["execution_plan"]

    def test_schedule_with_constraints(self, client):
        """Test scheduling with constraints."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": []},
                ],
                "constraints": {
                    "max_concurrent": 1,
                },
            },
        )
        assert response.status_code == 200
        data = response.json()
        # With max_concurrent=1, should have 2 phases
        assert len(data["execution_plan"]["phases"]) == 2

    def test_schedule_with_must_finish_first(self, client):
        """Test must_finish_first constraint."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P1", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": []},
                ],
                "constraints": {
                    "must_finish_first": ["task-1"],
                },
            },
        )
        assert response.status_code == 200
        data = response.json()
        # task-1 should be in first phase despite lower priority
        assert "task-1" in data["execution_plan"]["phases"][0]["tasks"]

    def test_schedule_detects_cycle(self, client):
        """Test cycle detection in API."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": ["task-2"]},
                    {"id": "task-2", "priority": "P0", "dependencies": ["task-1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["has_cycle"] is True
        assert len(data["cycle_tasks"]) > 0

    def test_schedule_empty_tasks_fails(self, client):
        """Test that empty tasks list returns error."""
        response = client.post(
            "/schedule",
            json={"tasks": []},
        )
        assert response.status_code == 400

    def test_schedule_returns_visualization(self, client):
        """Test that visualization is returned."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": ["task-1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["visualization"] != ""
        assert "→" in data["visualization"]

    def test_schedule_time_is_reasonable(self, client):
        """Test that schedule time is reasonable."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        # Should complete in under 100ms
        assert data["schedule_time_ms"] < 100

    def test_schedule_with_estimated_time(self, client):
        """Test scheduling with estimated times."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": [], "estimated_time": "1h"},
                    {"id": "task-2", "priority": "P0", "dependencies": ["task-1"], "estimated_time": "30min"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["execution_plan"]["estimated_total_time"] != ""

    def test_schedule_parallel_detection(self, client):
        """Test that parallel tasks are detected."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P0", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": []},
                    {"id": "task-3", "priority": "P0", "dependencies": []},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        # All tasks can run in parallel
        first_phase = data["execution_plan"]["phases"][0]
        assert first_phase["concurrent"] is True
        assert len(first_phase["tasks"]) == 3

    def test_schedule_priority_respected(self, client):
        """Test that priority is respected in scheduling."""
        response = client.post(
            "/schedule",
            json={
                "tasks": [
                    {"id": "task-1", "priority": "P2", "dependencies": []},
                    {"id": "task-2", "priority": "P0", "dependencies": []},
                    {"id": "task-3", "priority": "P1", "dependencies": []},
                ],
                "constraints": {"max_concurrent": 1},
            },
        )
        assert response.status_code == 200
        data = response.json()
        # P0 should be first
        phases = data["execution_plan"]["phases"]
        assert phases[0]["tasks"] == ["task-2"]
