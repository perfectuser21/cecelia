"""Tests for Orchestrator API routes with database mocking."""

from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.orchestrator.routes import router, set_database


# Mock database class
class MockDatabase:
    """Mock database for testing."""

    def __init__(self):
        self.trds = {}
        self.tasks = {}
        self.runs = {}
        self.workers = {}

    async def execute(self, query: str, *args):
        """Mock execute - handles inserts and updates."""
        query_lower = query.lower()
        if "insert into trds" in query_lower:
            self.trds[args[0]] = {
                "id": args[0],
                "title": args[1],
                "description": args[2] or "",
                "kr_id": args[3],
                "status": args[4],
                "projects": args[5],
                "acceptance_criteria": args[6],
                "created_at": args[7] or datetime.now(),
                "updated_at": args[8] or datetime.now(),
                "planned_at": args[9],
                "completed_at": args[10],
            }
        elif "insert into orchestrator_tasks" in query_lower:
            self.tasks[args[0]] = {
                "id": args[0],
                "trd_id": args[1],
                "title": args[2],
                "description": args[3] or "",
                "repo": args[4] or "",
                "branch": args[5] or "",
                "status": args[6],
                "priority": args[7] or "P1",
                "depends_on": args[8],
                "acceptance": args[9],
                "prd_content": args[10] or "",
                "pr_url": args[11],
                "worker_id": args[12],
                "retry_count": args[13] or 0,
                "max_retries": args[14] or 3,
                "blocked_reason": args[15],
                "blocked_at": args[16],
                "created_at": args[17] or datetime.now(),
                "updated_at": args[18] or datetime.now(),
                "started_at": args[19],
                "completed_at": args[20],
            }
        elif "insert into orchestrator_runs" in query_lower:
            self.runs[args[0]] = {
                "id": args[0],
                "task_id": args[1],
                "attempt": args[2] or 1,
                "status": args[3],
                "worker_id": args[4] or "",
                "log_file": args[5],
                "pr_url": args[6],
                "ci_status": args[7],
                "ci_run_id": args[8],
                "error": args[9],
                "started_at": args[10] or datetime.now(),
                "ended_at": args[11],
                "duration_seconds": args[12],
            }
        elif "insert into orchestrator_workers" in query_lower:
            self.workers[args[0]] = {
                "id": args[0],
                "name": args[1],
                "status": "idle",
                "current_task_id": None,
                "capabilities": args[2],
                "last_heartbeat": args[3] or datetime.now(),
                "created_at": datetime.now(),
            }
        elif "update orchestrator_workers" in query_lower:
            if args[1] in self.workers:
                self.workers[args[1]]["last_heartbeat"] = args[0]

    async def fetch(self, query: str, *args):
        """Mock fetch - returns list of rows."""
        query_lower = query.lower()
        if "group by status" in query_lower:
            # Handle GROUP BY queries for summary
            if "from trds" in query_lower:
                counts = {}
                for trd in self.trds.values():
                    status = trd["status"]
                    counts[status] = counts.get(status, 0) + 1
                return [{"status": s, "count": c} for s, c in counts.items()]
            elif "from orchestrator_tasks" in query_lower:
                counts = {}
                for task in self.tasks.values():
                    status = task["status"]
                    counts[status] = counts.get(status, 0) + 1
                return [{"status": s, "count": c} for s, c in counts.items()]
            return []
        elif "from trds" in query_lower:
            results = list(self.trds.values())
            if "where status" in query_lower and args:
                results = [r for r in results if r["status"] == args[0]]
            return results
        elif "from orchestrator_tasks" in query_lower:
            results = list(self.tasks.values())
            return results
        elif "from orchestrator_runs" in query_lower:
            results = list(self.runs.values())
            return results
        elif "from orchestrator_workers" in query_lower:
            return list(self.workers.values())
        return []

    async def fetchrow(self, query: str, *args):
        """Mock fetchrow - returns single row or None."""
        query_lower = query.lower()
        if "from trds" in query_lower and args:
            return self.trds.get(args[0])
        elif "from orchestrator_tasks" in query_lower and args:
            return self.tasks.get(args[0])
        elif "from orchestrator_runs" in query_lower and args:
            return self.runs.get(args[0])
        elif "from orchestrator_workers" in query_lower and args:
            return self.workers.get(args[0])
        return None

    async def fetchval(self, query: str, *args):
        """Mock fetchval - returns single value."""
        query_lower = query.lower()
        if "count" in query_lower:
            if "trds" in query_lower:
                return len(self.trds)
            elif "orchestrator_tasks" in query_lower:
                if "queued" in query_lower:
                    return len([t for t in self.tasks.values() if t["status"] == "queued"])
                return len(self.tasks)
            elif "orchestrator_workers" in query_lower:
                if "idle" in query_lower:
                    return len([w for w in self.workers.values() if w["status"] == "idle"])
                return len(self.workers)
            elif "orchestrator_runs" in query_lower:
                return len(self.runs)
        return 0


@pytest.fixture(autouse=True)
def setup_mock_db():
    """Set up mock database before each test."""
    mock_db = MockDatabase()
    set_database(mock_db)
    yield mock_db
    set_database(None)


app = FastAPI()
app.include_router(router)
client = TestClient(app)


class TestTRDRoutes:
    """Tests for TRD routes."""

    def test_create_trd(self):
        """Test creating a TRD."""
        response = client.post("/orchestrator/v2/trd", json={
            "title": "Test TRD",
            "description": "Test description",
            "projects": ["proj1"],
            "acceptance_criteria": ["criteria1"],
        })
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test TRD"
        assert data["status"] == "draft"
        assert "id" in data

    def test_get_trd(self):
        """Test getting a TRD."""
        create_response = client.post("/orchestrator/v2/trd", json={
            "title": "Test TRD",
        })
        trd_id = create_response.json()["id"]
        response = client.get(f"/orchestrator/v2/trd/{trd_id}")
        assert response.status_code == 200
        assert response.json()["id"] == trd_id

    def test_get_trd_not_found(self):
        """Test getting non-existent TRD."""
        response = client.get("/orchestrator/v2/trd/TRD-NONEXISTENT")
        assert response.status_code == 404

    def test_list_trds(self):
        """Test listing TRDs."""
        client.post("/orchestrator/v2/trd", json={"title": "TRD 1"})
        client.post("/orchestrator/v2/trd", json={"title": "TRD 2"})
        response = client.get("/orchestrator/v2/trds")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 2

    def test_list_trds_filter_by_status(self):
        """Test listing TRDs filtered by status."""
        client.post("/orchestrator/v2/trd", json={"title": "Test TRD"})
        response = client.get("/orchestrator/v2/trds?status=draft")
        assert response.status_code == 200
        for trd in response.json():
            assert trd["status"] == "draft"


class TestTaskRoutes:
    """Tests for Task routes."""

    def test_list_tasks(self):
        """Test listing tasks."""
        response = client.get("/orchestrator/v2/tasks")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_get_next_task_no_ready(self):
        """Test getting next task when none ready."""
        response = client.get("/orchestrator/v2/next")
        assert response.status_code == 200
        _ = response.json()


class TestWorkerRoutes:
    """Tests for Worker routes."""

    def test_register_worker(self):
        """Test registering a worker."""
        response = client.post("/orchestrator/v2/workers", json={
            "name": "Test Worker",
            "capabilities": ["python", "node"],
        })
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Worker"
        assert data["status"] == "idle"
        assert "id" in data

    def test_list_workers(self):
        """Test listing workers."""
        client.post("/orchestrator/v2/workers", json={"name": "Worker 1"})
        response = client.get("/orchestrator/v2/workers")
        assert response.status_code == 200
        assert len(response.json()) >= 1

    def test_worker_heartbeat(self):
        """Test worker heartbeat."""
        create_response = client.post("/orchestrator/v2/workers", json={"name": "Worker"})
        worker_id = create_response.json()["id"]
        response = client.post(f"/orchestrator/v2/workers/{worker_id}/heartbeat")
        assert response.status_code == 200


class TestTickRoute:
    """Tests for tick route."""

    def test_tick(self):
        """Test tick endpoint."""
        response = client.post("/orchestrator/v2/tick")
        assert response.status_code == 200
        data = response.json()
        assert "updated_trds" in data
        assert "updated_tasks" in data
        assert "retried_tasks" in data
        assert "unblocked_tasks" in data


class TestSummaryRoute:
    """Tests for summary route."""

    def test_summary(self):
        """Test summary endpoint."""
        response = client.get("/orchestrator/v2/summary")
        assert response.status_code == 200
        data = response.json()
        assert "trds" in data
        assert "tasks" in data
        assert "runs" in data


class TestIntegration:
    """Integration tests for full workflow."""

    def test_full_workflow(self):
        """Test full workflow: create TRD -> register worker."""
        trd_response = client.post("/orchestrator/v2/trd", json={
            "title": "Integration Test TRD",
            "description": "Test full workflow",
            "acceptance_criteria": ["AC1", "AC2"],
        })
        assert trd_response.status_code == 200
        trd = trd_response.json()
        assert trd["status"] == "draft"

        worker_response = client.post("/orchestrator/v2/workers", json={
            "name": "Integration Worker",
        })
        assert worker_response.status_code == 200
        worker = worker_response.json()
        assert worker["status"] == "idle"

        summary_response = client.get("/orchestrator/v2/summary")
        assert summary_response.status_code == 200
        summary = summary_response.json()
        assert summary["trds"]["total"] >= 1
