"""Tests for Orchestrator state machine."""

import pytest
from datetime import datetime

from src.autumnrice.models import (
    TRD,
    TRDStatus,
    Task,
    TaskStatus,
    Run,
    RunStatus,
)
from src.autumnrice.state_machine import StateMachine, StateTransitionError


class TestTRDTransitions:
    """Tests for TRD state transitions."""

    @pytest.fixture
    def sm(self):
        return StateMachine()

    def test_trd_draft_to_planned(self, sm):
        """Test TRD transition from draft to planned."""
        trd = TRD(status=TRDStatus.DRAFT)
        assert sm.can_transition_trd(trd, TRDStatus.PLANNED)
        trd = sm.transition_trd(trd, TRDStatus.PLANNED)
        assert trd.status == TRDStatus.PLANNED
        assert trd.planned_at is not None

    def test_trd_planned_to_in_progress(self, sm):
        """Test TRD transition from planned to in_progress."""
        trd = TRD(status=TRDStatus.PLANNED)
        assert sm.can_transition_trd(trd, TRDStatus.IN_PROGRESS)
        trd = sm.transition_trd(trd, TRDStatus.IN_PROGRESS)
        assert trd.status == TRDStatus.IN_PROGRESS

    def test_trd_in_progress_to_done(self, sm):
        """Test TRD transition from in_progress to done."""
        trd = TRD(status=TRDStatus.IN_PROGRESS)
        assert sm.can_transition_trd(trd, TRDStatus.DONE)
        trd = sm.transition_trd(trd, TRDStatus.DONE)
        assert trd.status == TRDStatus.DONE
        assert trd.completed_at is not None

    def test_trd_in_progress_to_blocked(self, sm):
        """Test TRD transition from in_progress to blocked."""
        trd = TRD(status=TRDStatus.IN_PROGRESS)
        assert sm.can_transition_trd(trd, TRDStatus.BLOCKED)
        trd = sm.transition_trd(trd, TRDStatus.BLOCKED)
        assert trd.status == TRDStatus.BLOCKED

    def test_trd_blocked_to_in_progress(self, sm):
        """Test TRD transition from blocked back to in_progress."""
        trd = TRD(status=TRDStatus.BLOCKED)
        assert sm.can_transition_trd(trd, TRDStatus.IN_PROGRESS)
        trd = sm.transition_trd(trd, TRDStatus.IN_PROGRESS)
        assert trd.status == TRDStatus.IN_PROGRESS

    def test_trd_invalid_transition(self, sm):
        """Test invalid TRD transition raises error."""
        trd = TRD(status=TRDStatus.DRAFT)
        assert not sm.can_transition_trd(trd, TRDStatus.DONE)
        with pytest.raises(StateTransitionError):
            sm.transition_trd(trd, TRDStatus.DONE)

    def test_plan_trd(self, sm):
        """Test planning a TRD with tasks."""
        trd = TRD(status=TRDStatus.DRAFT, title="Test TRD")
        tasks = [
            Task(title="Task 1"),
            Task(title="Task 2"),
        ]
        trd, tasks = sm.plan_trd(trd, tasks)
        assert trd.status == TRDStatus.PLANNED
        for task in tasks:
            assert task.trd_id == trd.id


class TestTaskTransitions:
    """Tests for Task state transitions."""

    @pytest.fixture
    def sm(self):
        return StateMachine()

    def test_task_queued_to_assigned(self, sm):
        """Test Task transition from queued to assigned."""
        task = Task(status=TaskStatus.QUEUED)
        task = sm.assign_task(task, "W-001")
        assert task.status == TaskStatus.ASSIGNED
        assert task.worker_id == "W-001"

    def test_task_assigned_to_running(self, sm):
        """Test Task transition from assigned to running."""
        task = Task(status=TaskStatus.ASSIGNED, worker_id="W-001")
        task = sm.start_task(task)
        assert task.status == TaskStatus.RUNNING
        assert task.started_at is not None

    def test_task_running_to_done(self, sm):
        """Test Task transition from running to done."""
        task = Task(status=TaskStatus.RUNNING)
        task = sm.complete_task(task, pr_url="https://github.com/pr/1")
        assert task.status == TaskStatus.DONE
        assert task.pr_url == "https://github.com/pr/1"
        assert task.completed_at is not None

    def test_task_running_to_failed(self, sm):
        """Test Task transition from running to failed."""
        task = Task(status=TaskStatus.RUNNING)
        task = sm.fail_task(task, error="Test error")
        assert task.status == TaskStatus.FAILED
        assert task.blocked_reason == "Test error"

    def test_task_running_to_blocked(self, sm):
        """Test Task transition from running to blocked."""
        task = Task(status=TaskStatus.RUNNING)
        task = sm.block_task(task, reason="Waiting for review")
        assert task.status == TaskStatus.BLOCKED
        assert task.blocked_reason == "Waiting for review"
        assert task.blocked_at is not None

    def test_task_failed_to_queued_retry(self, sm):
        """Test Task retry from failed to queued."""
        task = Task(status=TaskStatus.FAILED, retry_count=0, max_retries=3)
        task = sm.retry_task(task)
        assert task.status == TaskStatus.QUEUED
        assert task.retry_count == 1

    def test_task_retry_exceeds_max(self, sm):
        """Test Task retry fails when max retries exceeded."""
        task = Task(status=TaskStatus.FAILED, retry_count=3, max_retries=3)
        with pytest.raises(StateTransitionError):
            sm.retry_task(task)

    def test_task_unblock(self, sm):
        """Test unblocking a blocked task."""
        task = Task(status=TaskStatus.BLOCKED, blocked_reason="Test", blocked_at=datetime.now())
        task = sm.unblock_task(task)
        assert task.status == TaskStatus.QUEUED
        assert task.blocked_reason is None
        assert task.blocked_at is None


class TestRunTransitions:
    """Tests for Run state transitions."""

    @pytest.fixture
    def sm(self):
        return StateMachine()

    def test_run_running_to_success(self, sm):
        """Test Run transition from running to success."""
        run = Run(status=RunStatus.RUNNING)
        assert sm.can_transition_run(run, RunStatus.SUCCESS)
        run = sm.transition_run(run, RunStatus.SUCCESS)
        assert run.status == RunStatus.SUCCESS
        assert run.ended_at is not None

    def test_run_running_to_failed(self, sm):
        """Test Run transition from running to failed."""
        run = Run(status=RunStatus.RUNNING)
        run = sm.transition_run(run, RunStatus.FAILED, error="Test error")
        assert run.status == RunStatus.FAILED
        assert run.error == "Test error"

    def test_run_invalid_transition(self, sm):
        """Test invalid Run transition raises error."""
        run = Run(status=RunStatus.SUCCESS)
        assert not sm.can_transition_run(run, RunStatus.RUNNING)
        with pytest.raises(StateTransitionError):
            sm.transition_run(run, RunStatus.RUNNING)


class TestTick:
    """Tests for state machine tick."""

    @pytest.fixture
    def sm(self):
        return StateMachine(blocked_threshold_minutes=1)

    def test_tick_completes_trd(self, sm):
        """Test tick completes TRD when all tasks done."""
        trd = TRD(id="TRD-001", status=TRDStatus.IN_PROGRESS)
        tasks = [
            Task(id="T-001", trd_id="TRD-001", status=TaskStatus.DONE),
            Task(id="T-002", trd_id="TRD-001", status=TaskStatus.DONE),
        ]
        result = sm.tick([trd], tasks, [])
        assert trd.id in [t.id for t in result["updated_trds"]]
        assert trd.status == TRDStatus.DONE

    def test_tick_retries_failed_task(self, sm):
        """Test tick retries failed tasks."""
        trd = TRD(id="TRD-001", status=TRDStatus.IN_PROGRESS)
        task = Task(id="T-001", trd_id="TRD-001", status=TaskStatus.FAILED, retry_count=0, max_retries=3)
        result = sm.tick([trd], [task], [])
        assert task.id in [t.id for t in result["retried_tasks"]]
        assert task.status == TaskStatus.QUEUED
        assert task.retry_count == 1

    def test_tick_unlocks_dependencies(self, sm):
        """Test tick unlocks task dependencies."""
        trd = TRD(id="TRD-001", status=TRDStatus.IN_PROGRESS)
        task1 = Task(id="T-001", trd_id="TRD-001", status=TaskStatus.DONE)
        task2 = Task(id="T-002", trd_id="TRD-001", status=TaskStatus.QUEUED, depends_on=["T-001"])
        result = sm.tick([trd], [task1, task2], [])
        assert task2.id in [t.id for t in result["unblocked_tasks"]]
        assert task2.depends_on == []


class TestGetReadyTasks:
    """Tests for get_ready_tasks."""

    @pytest.fixture
    def sm(self):
        return StateMachine()

    def test_get_ready_tasks_simple(self, sm):
        """Test getting ready tasks with no dependencies."""
        tasks = [
            Task(id="T-001", status=TaskStatus.QUEUED, priority="P1"),
            Task(id="T-002", status=TaskStatus.QUEUED, priority="P0"),
            Task(id="T-003", status=TaskStatus.RUNNING, priority="P0"),
        ]
        ready = sm.get_ready_tasks(tasks)
        assert len(ready) == 2
        assert ready[0].id == "T-002"  # P0 first
        assert ready[1].id == "T-001"

    def test_get_ready_tasks_with_deps(self, sm):
        """Test getting ready tasks with dependencies."""
        tasks = [
            Task(id="T-001", status=TaskStatus.DONE),
            Task(id="T-002", status=TaskStatus.QUEUED, depends_on=["T-001"]),
            Task(id="T-003", status=TaskStatus.QUEUED, depends_on=["T-002"]),
        ]
        ready = sm.get_ready_tasks(tasks)
        assert len(ready) == 1
        assert ready[0].id == "T-002"


class TestValidateNoCycles:
    """Tests for cycle detection."""

    @pytest.fixture
    def sm(self):
        return StateMachine()

    def test_no_cycles(self, sm):
        """Test valid DAG with no cycles."""
        tasks = [
            Task(id="T-001", depends_on=[]),
            Task(id="T-002", depends_on=["T-001"]),
            Task(id="T-003", depends_on=["T-001", "T-002"]),
        ]
        is_valid, cycle_nodes = sm.validate_no_cycles(tasks)
        assert is_valid is True
        assert cycle_nodes == []

    def test_simple_cycle(self, sm):
        """Test simple cycle detection."""
        tasks = [
            Task(id="T-001", depends_on=["T-002"]),
            Task(id="T-002", depends_on=["T-001"]),
        ]
        is_valid, cycle_nodes = sm.validate_no_cycles(tasks)
        assert is_valid is False

    def test_complex_cycle(self, sm):
        """Test complex cycle detection."""
        tasks = [
            Task(id="T-001", depends_on=[]),
            Task(id="T-002", depends_on=["T-001"]),
            Task(id="T-003", depends_on=["T-002"]),
            Task(id="T-004", depends_on=["T-003"]),
            Task(id="T-002", depends_on=["T-004"]),  # Cycle: T-002 -> T-003 -> T-004 -> T-002
        ]
        is_valid, cycle_nodes = sm.validate_no_cycles(tasks)
        # Note: This test has duplicate T-002, which is invalid but should still detect cycle
        assert is_valid is False
