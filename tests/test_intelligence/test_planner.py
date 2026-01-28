"""Tests for ExecutionPlanner."""

from src.intelligence.planner.execution_planner import (
    ExecutionPlanner,
    PlannerResult,
)


class TestExecutionPlanner:
    """Test suite for ExecutionPlanner."""

    def setup_method(self):
        """Set up test fixtures."""
        self.planner = ExecutionPlanner(max_concurrent=3)

    def test_planner_initialization(self):
        """Test planner initializes correctly."""
        assert self.planner.max_concurrent == 3

    def test_plan_simple_tasks(self):
        """Test planning simple tasks."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued"},
            {"id": "t2", "priority": "P1", "status": "queued"},
        ]
        result = self.planner.plan(tasks)
        assert isinstance(result, PlannerResult)
        assert result.current_tasks.total == 2

    def test_calculate_stats_by_priority(self):
        """Test calculating stats by priority."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued"},
            {"id": "t2", "priority": "P0", "status": "queued"},
            {"id": "t3", "priority": "P1", "status": "queued"},
            {"id": "t4", "priority": "P2", "status": "queued"},
        ]
        result = self.planner.plan(tasks)
        assert result.current_tasks.by_priority["P0"] == 2
        assert result.current_tasks.by_priority["P1"] == 1
        assert result.current_tasks.by_priority["P2"] == 1

    def test_calculate_stats_by_status(self):
        """Test calculating stats by status."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued"},
            {"id": "t2", "priority": "P0", "status": "in_progress"},
            {"id": "t3", "priority": "P1", "status": "completed"},
        ]
        result = self.planner.plan(tasks)
        assert result.current_tasks.by_status["queued"] == 1
        assert result.current_tasks.by_status["in_progress"] == 1
        assert result.current_tasks.by_status["completed"] == 1

    def test_execution_plan_next_up(self):
        """Test execution plan identifies next tasks."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t2", "priority": "P1", "status": "queued", "dependencies": []},
        ]
        result = self.planner.plan(tasks)
        assert "t1" in result.execution_plan.next_up
        assert "t2" in result.execution_plan.next_up

    def test_execution_plan_respects_dependencies(self):
        """Test execution plan respects dependencies."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t2", "priority": "P0", "status": "queued", "dependencies": ["t1"]},
        ]
        result = self.planner.plan(tasks)
        # t1 should be next_up, t2 should be waiting
        assert "t1" in result.execution_plan.next_up
        assert "t2" in result.execution_plan.waiting

    def test_execution_plan_in_progress(self):
        """Test execution plan tracks in_progress tasks."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "in_progress"},
            {"id": "t2", "priority": "P1", "status": "queued"},
        ]
        result = self.planner.plan(tasks)
        assert "t1" in result.execution_plan.in_progress

    def test_execution_plan_blocked_tasks(self):
        """Test execution plan identifies blocked tasks."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "blocked_by": ["external"]},
        ]
        result = self.planner.plan(tasks)
        assert "t1" in result.execution_plan.blocked

    def test_find_bottlenecks(self):
        """Test finding bottleneck tasks."""
        # t1 blocks 4 tasks - should be a bottleneck
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t2", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
            {"id": "t3", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
            {"id": "t4", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
            {"id": "t5", "priority": "P2", "status": "queued", "dependencies": ["t1"]},
        ]
        result = self.planner.plan(tasks)
        assert len(result.bottlenecks) >= 1
        assert result.bottlenecks[0].task_id == "t1"
        assert result.bottlenecks[0].blocked_count == 4

    def test_no_bottlenecks_for_small_chains(self):
        """Test no bottlenecks for small dependency chains."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t2", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
        ]
        result = self.planner.plan(tasks)
        # Only 1 dependency doesn't count as bottleneck
        assert len(result.bottlenecks) == 0

    def test_estimated_completion(self):
        """Test completion time estimation."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "estimated_time": "1h"},
            {"id": "t2", "priority": "P1", "status": "queued", "estimated_time": "30min"},
        ]
        result = self.planner.plan(tasks)
        assert result.estimated_completion != ""
        # 90min total, with parallelism should be less

    def test_estimated_completion_excludes_completed(self):
        """Test estimation excludes completed tasks."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "completed", "estimated_time": "10h"},
            {"id": "t2", "priority": "P1", "status": "queued", "estimated_time": "30min"},
        ]
        result = self.planner.plan(tasks)
        # Should not include 10h from completed task
        assert "10" not in result.estimated_completion

    def test_to_dict(self):
        """Test result conversion to dictionary."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued"},
        ]
        result = self.planner.plan(tasks)
        d = result.to_dict()
        assert "current_tasks" in d
        assert "execution_plan" in d
        assert "estimated_completion" in d
        assert "bottlenecks" in d
        assert "risks" in d

    def test_get_summary(self):
        """Test getting summary."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued"},
        ]
        summary = self.planner.get_summary(tasks)
        assert isinstance(summary, dict)
        assert "current_tasks" in summary

    def test_priority_sorting_in_next_up(self):
        """Test that next_up is sorted by priority."""
        tasks = [
            {"id": "t1", "priority": "P2", "status": "queued", "dependencies": []},
            {"id": "t2", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t3", "priority": "P1", "status": "queued", "dependencies": []},
        ]
        result = self.planner.plan(tasks)
        # P0 should be first
        assert result.execution_plan.next_up[0] == "t2"

    def test_max_concurrent_respected(self):
        """Test that max_concurrent is respected in next_up."""
        planner = ExecutionPlanner(max_concurrent=2)
        tasks = [
            {"id": "t1", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t2", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t3", "priority": "P0", "status": "queued", "dependencies": []},
            {"id": "t4", "priority": "P0", "status": "queued", "dependencies": []},
        ]
        result = planner.plan(tasks)
        # Only 2 should be in next_up
        assert len(result.execution_plan.next_up) <= 2

    def test_dependencies_met_after_completion(self):
        """Test that tasks become available after dependencies complete."""
        tasks = [
            {"id": "t1", "priority": "P0", "status": "completed", "dependencies": []},
            {"id": "t2", "priority": "P1", "status": "queued", "dependencies": ["t1"]},
        ]
        result = self.planner.plan(tasks)
        # t2 should be ready now that t1 is completed
        assert "t2" in result.execution_plan.next_up
