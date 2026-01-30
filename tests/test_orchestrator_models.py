"""Tests for Orchestrator models."""


from src.autumnrice.models import (
    TRD,
    TRDStatus,
    Task,
    TaskStatus,
    Run,
    RunStatus,
    generate_trd_id,
    generate_task_id,
    generate_run_id,
)


class TestTRD:
    """Tests for TRD model."""

    def test_create_trd_with_defaults(self):
        """Test TRD creation with default values."""
        trd = TRD()
        assert trd.id.startswith("TRD-")
        assert trd.status == TRDStatus.DRAFT
        assert trd.title == ""
        assert trd.projects == []

    def test_create_trd_with_values(self):
        """Test TRD creation with values."""
        trd = TRD(
            title="Test TRD",
            description="Test description",
            kr_id="KR-001",
            projects=["proj1", "proj2"],
            acceptance_criteria=["criteria1", "criteria2"],
        )
        assert trd.title == "Test TRD"
        assert trd.kr_id == "KR-001"
        assert len(trd.projects) == 2
        assert len(trd.acceptance_criteria) == 2

    def test_trd_to_dict(self):
        """Test TRD serialization."""
        trd = TRD(title="Test")
        data = trd.to_dict()
        assert data["title"] == "Test"
        assert data["status"] == "draft"
        assert "id" in data
        assert "created_at" in data

    def test_trd_from_dict(self):
        """Test TRD deserialization."""
        data = {
            "id": "TRD-2026-01-01-ABC",
            "title": "Test",
            "status": "planned",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        }
        trd = TRD.from_dict(data)
        assert trd.id == "TRD-2026-01-01-ABC"
        assert trd.title == "Test"
        assert trd.status == TRDStatus.PLANNED


class TestTask:
    """Tests for Task model."""

    def test_create_task_with_defaults(self):
        """Test Task creation with default values."""
        task = Task()
        assert task.id.startswith("T-")
        assert task.status == TaskStatus.QUEUED
        assert task.priority == "P1"
        assert task.retry_count == 0
        assert task.max_retries == 3

    def test_create_task_with_values(self):
        """Test Task creation with values."""
        task = Task(
            title="Test Task",
            trd_id="TRD-001",
            repo="/path/to/repo",
            branch="feature/test",
            priority="P0",
            depends_on=["T-001"],
            acceptance=["acc1", "acc2"],
        )
        assert task.title == "Test Task"
        assert task.trd_id == "TRD-001"
        assert task.priority == "P0"
        assert len(task.depends_on) == 1

    def test_task_is_ready_no_deps(self):
        """Test task ready state with no dependencies."""
        task = Task(status=TaskStatus.QUEUED)
        assert task.is_ready is True

    def test_task_is_ready_with_deps(self):
        """Test task ready state with dependencies."""
        task = Task(status=TaskStatus.QUEUED, depends_on=["T-001"])
        assert task.is_ready is False

    def test_task_not_ready_if_not_queued(self):
        """Test task not ready if not queued."""
        task = Task(status=TaskStatus.RUNNING)
        assert task.is_ready is False

    def test_task_to_dict(self):
        """Test Task serialization."""
        task = Task(title="Test", repo="/repo", branch="main")
        data = task.to_dict()
        assert data["title"] == "Test"
        assert data["repo"] == "/repo"
        assert data["status"] == "queued"

    def test_task_from_dict(self):
        """Test Task deserialization."""
        data = {
            "id": "T-ABC123",
            "title": "Test",
            "status": "running",
            "priority": "P0",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        }
        task = Task.from_dict(data)
        assert task.id == "T-ABC123"
        assert task.status == TaskStatus.RUNNING
        assert task.priority == "P0"


class TestRun:
    """Tests for Run model."""

    def test_create_run_with_defaults(self):
        """Test Run creation with default values."""
        run = Run()
        assert run.id.startswith("R-")
        assert run.status == RunStatus.RUNNING
        assert run.attempt == 1

    def test_create_run_with_values(self):
        """Test Run creation with values."""
        run = Run(
            task_id="T-001",
            attempt=2,
            worker_id="W-001",
        )
        assert run.task_id == "T-001"
        assert run.attempt == 2
        assert run.worker_id == "W-001"

    def test_run_complete_success(self):
        """Test Run completion with success."""
        run = Run()
        run.complete(RunStatus.SUCCESS)
        assert run.status == RunStatus.SUCCESS
        assert run.ended_at is not None
        assert run.duration_seconds is not None

    def test_run_complete_failure(self):
        """Test Run completion with failure."""
        run = Run()
        run.complete(RunStatus.FAILED, error="Test error")
        assert run.status == RunStatus.FAILED
        assert run.error == "Test error"

    def test_run_to_dict(self):
        """Test Run serialization."""
        run = Run(task_id="T-001", worker_id="W-001")
        data = run.to_dict()
        assert data["task_id"] == "T-001"
        assert data["worker_id"] == "W-001"
        assert data["status"] == "running"

    def test_run_from_dict(self):
        """Test Run deserialization."""
        data = {
            "id": "R-12345678",
            "task_id": "T-001",
            "status": "success",
            "attempt": 2,
            "worker_id": "W-001",
            "started_at": "2026-01-01T00:00:00",
        }
        run = Run.from_dict(data)
        assert run.id == "R-12345678"
        assert run.status == RunStatus.SUCCESS
        assert run.attempt == 2


class TestIDGenerators:
    """Tests for ID generators."""

    def test_generate_trd_id(self):
        """Test TRD ID generation."""
        trd_id = generate_trd_id()
        assert trd_id.startswith("TRD-")
        parts = trd_id.split("-")
        assert len(parts) == 5  # TRD-YYYY-MM-DD-XXX

    def test_generate_task_id(self):
        """Test Task ID generation."""
        task_id = generate_task_id()
        assert task_id.startswith("T-")
        assert len(task_id) == 8  # T-XXXXXX

    def test_generate_run_id(self):
        """Test Run ID generation."""
        run_id = generate_run_id()
        assert run_id.startswith("R-")
        assert len(run_id) == 10  # R-XXXXXXXX
