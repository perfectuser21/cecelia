"""Tests for /plan API endpoint."""

import pytest
from fastapi.testclient import TestClient

from src.api.main import app


@pytest.fixture
def client():
    """Create test client."""
    with TestClient(app) as c:
        yield c


class TestPlanAPI:
    """Test suite for /plan API endpoint."""

    def test_plan_simple_tasks(self, client):
        """Test planning simple tasks."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued"},
                    {"id": "t2", "priority": "P1", "status": "queued"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "current_tasks" in data
        assert "execution_plan" in data
        assert "estimated_completion" in data
        assert "bottlenecks" in data

    def test_plan_returns_stats(self, client):
        """Test that plan returns task statistics."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued"},
                    {"id": "t2", "priority": "P0", "status": "in_progress"},
                    {"id": "t3", "priority": "P1", "status": "completed"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        stats = data["current_tasks"]
        assert stats["total"] == 3
        assert "by_priority" in stats
        assert "by_status" in stats

    def test_plan_returns_execution_plan(self, client):
        """Test that plan returns execution plan."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
                    {"id": "t2", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        plan = data["execution_plan"]
        assert "next_up" in plan
        assert "in_progress" in plan
        assert "waiting" in plan
        assert "blocked" in plan

    def test_plan_returns_bottlenecks(self, client):
        """Test that plan identifies bottlenecks."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
                    {"id": "t2", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
                    {"id": "t3", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
                    {"id": "t4", "priority": "P2", "status": "queued", "dependencies": ["t1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "bottlenecks" in data
        # t1 blocks 3 tasks, should be a bottleneck
        assert len(data["bottlenecks"]) >= 1

    def test_plan_empty_tasks_fails(self, client):
        """Test that empty tasks returns error."""
        response = client.post(
            "/plan",
            json={"tasks": []},
        )
        assert response.status_code == 400

    def test_plan_with_dependencies(self, client):
        """Test planning with dependencies."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "completed", "dependencies": []},
                    {"id": "t2", "priority": "P0", "status": "queued", "dependencies": ["t1"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        # t2 should be ready since t1 is completed
        assert "t2" in data["execution_plan"]["next_up"]

    def test_plan_with_blocked_tasks(self, client):
        """Test planning with blocked tasks."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued", "blocked_by": ["external"]},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "t1" in data["execution_plan"]["blocked"]

    def test_plan_summary(self, client):
        """Test getting planner summary."""
        response = client.get("/plan/summary")
        assert response.status_code == 200
        data = response.json()
        assert "planner" in data
        assert "max_concurrent" in data
        assert "capabilities" in data

    def test_plan_returns_estimated_completion(self, client):
        """Test that plan returns estimated completion time."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued", "estimated_time": "1h"},
                    {"id": "t2", "priority": "P1", "status": "queued", "estimated_time": "30min"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["estimated_completion"] != ""

    def test_plan_returns_risks(self, client):
        """Test that plan returns risks list."""
        response = client.post(
            "/plan",
            json={
                "tasks": [
                    {"id": "t1", "priority": "P0", "status": "queued"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "risks" in data
        assert isinstance(data["risks"], list)
