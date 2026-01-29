"""Tests for Orchestrator API routes."""

from fastapi.testclient import TestClient

from src.orchestrator.routes import router


# Create a test app
from fastapi import FastAPI

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
        # First create
        create_response = client.post("/orchestrator/v2/trd", json={
            "title": "Test TRD",
        })
        trd_id = create_response.json()["id"]

        # Then get
        response = client.get(f"/orchestrator/v2/trd/{trd_id}")
        assert response.status_code == 200
        assert response.json()["id"] == trd_id

    def test_get_trd_not_found(self):
        """Test getting non-existent TRD."""
        response = client.get("/orchestrator/v2/trd/TRD-NONEXISTENT")
        assert response.status_code == 404

    def test_list_trds(self):
        """Test listing TRDs."""
        # Create a few TRDs
        client.post("/orchestrator/v2/trd", json={"title": "TRD 1"})
        client.post("/orchestrator/v2/trd", json={"title": "TRD 2"})

        response = client.get("/orchestrator/v2/trds")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 2

    def test_list_trds_filter_by_status(self):
        """Test listing TRDs filtered by status."""
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
        # Response may or may not have ready tasks depending on test order
        _ = response.json()  # Verify JSON is valid


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
        # Register a worker first
        client.post("/orchestrator/v2/workers", json={"name": "Worker 1"})

        response = client.get("/orchestrator/v2/workers")
        assert response.status_code == 200
        assert len(response.json()) >= 1

    def test_worker_heartbeat(self):
        """Test worker heartbeat."""
        # Register
        create_response = client.post("/orchestrator/v2/workers", json={"name": "Worker"})
        worker_id = create_response.json()["id"]

        # Heartbeat
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
        """Test full workflow: create TRD -> register worker -> (plan would need LLM)."""
        # 1. Create TRD
        trd_response = client.post("/orchestrator/v2/trd", json={
            "title": "Integration Test TRD",
            "description": "Test full workflow",
            "acceptance_criteria": ["AC1", "AC2"],
        })
        assert trd_response.status_code == 200
        trd = trd_response.json()
        assert trd["status"] == "draft"

        # 2. Register worker
        worker_response = client.post("/orchestrator/v2/workers", json={
            "name": "Integration Worker",
        })
        assert worker_response.status_code == 200
        worker = worker_response.json()
        assert worker["status"] == "idle"

        # 3. Get summary
        summary_response = client.get("/orchestrator/v2/summary")
        assert summary_response.status_code == 200
        summary = summary_response.json()
        assert summary["trds"]["total"] >= 1
