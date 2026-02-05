"""Tests for Scheduler components."""

from src.intelligence.scheduler.priority_calculator import PriorityCalculator, TaskInput
from src.intelligence.scheduler.dependency_solver import DependencySolver
from src.intelligence.scheduler.concurrency_planner import ConcurrencyPlanner
from src.intelligence.scheduler.scheduler_service import SchedulerService


class TestPriorityCalculator:
    """Test suite for PriorityCalculator."""

    def setup_method(self):
        """Set up test fixtures."""
        self.calculator = PriorityCalculator()

    def test_sort_by_priority_p0_first(self):
        """Test that P0 tasks come before P1 and P2."""
        tasks = [
            TaskInput(id="t1", priority="P2", dependencies=[]),
            TaskInput(id="t2", priority="P0", dependencies=[]),
            TaskInput(id="t3", priority="P1", dependencies=[]),
        ]
        sorted_tasks = self.calculator.sort_by_priority(tasks)
        priorities = [t.priority for t in sorted_tasks]
        assert priorities == ["P0", "P1", "P2"]

    def test_group_by_priority(self):
        """Test grouping tasks by priority."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[]),
            TaskInput(id="t2", priority="P1", dependencies=[]),
            TaskInput(id="t3", priority="P0", dependencies=[]),
            TaskInput(id="t4", priority="P2", dependencies=[]),
        ]
        groups = self.calculator.group_by_priority(tasks)
        assert len(groups["P0"]) == 2
        assert len(groups["P1"]) == 1
        assert len(groups["P2"]) == 1

    def test_effective_priority_blocker_bonus(self):
        """Test that blocking a P0 task increases priority."""
        tasks = [
            TaskInput(id="t1", priority="P1", dependencies=[]),
            TaskInput(id="t2", priority="P0", dependencies=["t1"]),
        ]
        all_tasks = {t.id: t for t in tasks}
        # t1 blocks t2 (P0), so t1 should get a bonus
        effective = self.calculator.calculate_effective_priority(tasks[0], all_tasks)
        base = self.calculator.PRIORITY_WEIGHTS["P1"]
        assert effective < base  # Should be boosted


class TestDependencySolver:
    """Test suite for DependencySolver."""

    def setup_method(self):
        """Set up test fixtures."""
        self.solver = DependencySolver()

    def test_solve_linear_dependencies(self):
        """Test solving linear dependency chain."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[]),
            TaskInput(id="t2", priority="P0", dependencies=["t1"]),
            TaskInput(id="t3", priority="P0", dependencies=["t2"]),
        ]
        result = self.solver.solve(tasks)
        assert result.execution_order == ["t1", "t2", "t3"]
        assert not result.has_cycle

    def test_solve_parallel_tasks(self):
        """Test solving tasks with no dependencies."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[]),
            TaskInput(id="t2", priority="P0", dependencies=[]),
            TaskInput(id="t3", priority="P0", dependencies=[]),
        ]
        result = self.solver.solve(tasks)
        assert len(result.execution_order) == 3
        assert not result.has_cycle

    def test_detect_cycle(self):
        """Test cycle detection."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=["t2"]),
            TaskInput(id="t2", priority="P0", dependencies=["t1"]),
        ]
        has_cycle, cycle_tasks = self.solver.detect_cycle(tasks)
        assert has_cycle
        assert len(cycle_tasks) > 0

    def test_find_critical_path(self):
        """Test finding critical path."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[]),
            TaskInput(id="t2", priority="P0", dependencies=["t1"]),
            TaskInput(id="t3", priority="P0", dependencies=["t2"]),
        ]
        result = self.solver.solve(tasks)
        critical_path = self.solver.find_critical_path(tasks, result.execution_order)
        assert critical_path == ["t1", "t2", "t3"]

    def test_priority_order_in_execution(self):
        """Test that P0 tasks come before P1 when no dependencies."""
        tasks = [
            TaskInput(id="t1", priority="P1", dependencies=[]),
            TaskInput(id="t2", priority="P0", dependencies=[]),
        ]
        result = self.solver.solve(tasks)
        assert result.execution_order.index("t2") < result.execution_order.index("t1")


class TestConcurrencyPlanner:
    """Test suite for ConcurrencyPlanner."""

    def setup_method(self):
        """Set up test fixtures."""
        self.planner = ConcurrencyPlanner(max_concurrent=3)

    def test_plan_sequential_tasks(self):
        """Test planning sequential tasks."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t2", priority="P0", dependencies=["t1"], estimated_time="1h"),
        ]
        plan = self.planner.plan(tasks, ["t1", "t2"])
        assert len(plan.phases) == 2
        assert plan.phases[0].tasks == ["t1"]
        assert plan.phases[1].tasks == ["t2"]

    def test_plan_parallel_tasks(self):
        """Test planning parallel tasks."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t2", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t3", priority="P0", dependencies=[], estimated_time="1h"),
        ]
        plan = self.planner.plan(tasks, ["t1", "t2", "t3"])
        # All tasks can run in parallel
        assert len(plan.phases) == 1
        assert len(plan.phases[0].tasks) == 3
        assert plan.phases[0].concurrent is True

    def test_max_concurrent_limit(self):
        """Test that max_concurrent is respected."""
        planner = ConcurrencyPlanner(max_concurrent=2)
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t2", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t3", priority="P0", dependencies=[], estimated_time="1h"),
        ]
        plan = planner.plan(tasks, ["t1", "t2", "t3"])
        # First phase should have max 2 tasks
        assert len(plan.phases[0].tasks) <= 2

    def test_must_finish_first_constraint(self):
        """Test must_finish_first constraint."""
        tasks = [
            TaskInput(id="t1", priority="P1", dependencies=[], estimated_time="1h"),
            TaskInput(id="t2", priority="P0", dependencies=[], estimated_time="1h"),
        ]
        plan = self.planner.plan(tasks, ["t2", "t1"], must_finish_first=["t1"])
        # t1 should be first despite lower priority
        assert plan.phases[0].tasks == ["t1"]

    def test_visualization_generated(self):
        """Test that visualization is generated."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t2", priority="P0", dependencies=["t1"], estimated_time="1h"),
        ]
        plan = self.planner.plan(tasks, ["t1", "t2"])
        assert "t1" in plan.visualization
        assert "→" in plan.visualization

    def test_estimated_time_calculation(self):
        """Test total time estimation."""
        tasks = [
            TaskInput(id="t1", priority="P0", dependencies=[], estimated_time="1h"),
            TaskInput(id="t2", priority="P0", dependencies=["t1"], estimated_time="30min"),
        ]
        plan = self.planner.plan(tasks, ["t1", "t2"])
        assert plan.estimated_total_time != ""


class TestSchedulerService:
    """Test suite for SchedulerService."""

    def setup_method(self):
        """Set up test fixtures."""
        self.service = SchedulerService(max_concurrent=3)

    def test_schedule_simple_tasks(self):
        """Test scheduling simple tasks."""
        tasks = [
            {"id": "t1", "priority": "P0", "dependencies": []},
            {"id": "t2", "priority": "P0", "dependencies": ["t1"]},
        ]
        result = self.service.schedule(tasks)
        assert not result.has_cycle
        assert len(result.execution_plan["phases"]) >= 1

    def test_schedule_with_constraints(self):
        """Test scheduling with constraints."""
        tasks = [
            {"id": "t1", "priority": "P0", "dependencies": []},
            {"id": "t2", "priority": "P0", "dependencies": []},
        ]
        constraints = {"max_concurrent": 1}
        result = self.service.schedule(tasks, constraints)
        # With max_concurrent=1, should have 2 phases
        assert len(result.execution_plan["phases"]) == 2

    def test_schedule_detects_cycle(self):
        """Test that cycles are detected."""
        tasks = [
            {"id": "t1", "priority": "P0", "dependencies": ["t2"]},
            {"id": "t2", "priority": "P0", "dependencies": ["t1"]},
        ]
        result = self.service.schedule(tasks)
        assert result.has_cycle
        assert len(result.cycle_tasks) > 0

    def test_schedule_returns_critical_path(self):
        """Test that critical path is returned."""
        tasks = [
            {"id": "t1", "priority": "P0", "dependencies": []},
            {"id": "t2", "priority": "P0", "dependencies": ["t1"]},
            {"id": "t3", "priority": "P0", "dependencies": ["t2"]},
        ]
        result = self.service.schedule(tasks)
        assert len(result.execution_plan["critical_path"]) == 3

    def test_schedule_time_ms_recorded(self):
        """Test that schedule time is recorded."""
        tasks = [
            {"id": "t1", "priority": "P0", "dependencies": []},
        ]
        result = self.service.schedule(tasks)
        assert result.schedule_time_ms >= 0

    def test_to_dict(self):
        """Test result serialization."""
        tasks = [
            {"id": "t1", "priority": "P0", "dependencies": []},
        ]
        result = self.service.schedule(tasks)
        result_dict = result.to_dict()
        assert "execution_plan" in result_dict
        assert "visualization" in result_dict
        assert "schedule_time_ms" in result_dict
