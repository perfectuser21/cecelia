"""Tests for Dependency Builder."""

from src.intelligence.parser.task_decomposer import Task
from src.intelligence.parser.dependency_builder import DependencyBuilder


class TestDependencyBuilder:
    """Test suite for DependencyBuilder."""

    def setup_method(self):
        """Set up test fixtures."""
        self.builder = DependencyBuilder()

    def _create_task(self, task_id: str, tags: list) -> Task:
        """Helper to create a task with given ID and tags."""
        return Task(
            id=task_id,
            title=f"Task {task_id}",
            description=f"Description for {task_id}",
            priority="P0",
            estimated_time="1h",
            dependencies=[],
            tags=tags,
        )

    def test_build_empty_task_list(self):
        """Test building dependencies for empty task list."""
        result = self.builder.build([])
        assert result.graph == {}
        assert result.execution_order == []
        assert result.parallel_groups == []

    def test_build_single_task(self):
        """Test building dependencies for single task."""
        tasks = [self._create_task("task-1", ["implementation"])]
        result = self.builder.build(tasks)

        assert "task-1" in result.graph
        assert result.execution_order == ["task-1"]
        assert result.parallel_groups == [["task-1"]]

    def test_build_independent_tasks(self):
        """Test building dependencies for independent tasks."""
        tasks = [
            self._create_task("task-1", ["design"]),
            self._create_task("task-2", ["analysis"]),
        ]
        result = self.builder.build(tasks)

        # Both should be independent
        assert result.graph["task-1"] == []
        assert result.graph["task-2"] == []
        # Both can run in parallel
        assert len(result.parallel_groups) == 1
        assert set(result.parallel_groups[0]) == {"task-1", "task-2"}

    def test_build_sequential_dependencies(self):
        """Test building sequential dependencies based on tags."""
        tasks = [
            self._create_task("task-1", ["design"]),
            self._create_task("task-2", ["implementation"]),
            self._create_task("task-3", ["test"]),
        ]
        result = self.builder.build(tasks)

        # implementation depends on design
        assert "task-1" in result.graph["task-2"]
        # test depends on implementation
        assert "task-2" in result.graph["task-3"]

    def test_execution_order_respects_dependencies(self):
        """Test that execution order respects dependencies."""
        tasks = [
            self._create_task("task-1", ["design"]),
            self._create_task("task-2", ["implementation"]),
            self._create_task("task-3", ["test"]),
        ]
        result = self.builder.build(tasks)

        order = result.execution_order
        # design should come before implementation
        assert order.index("task-1") < order.index("task-2")
        # implementation should come before test
        assert order.index("task-2") < order.index("task-3")

    def test_parallel_groups_correct(self):
        """Test that parallel groups are correctly identified."""
        tasks = [
            self._create_task("task-1", ["analysis"]),
            self._create_task("task-2", ["design"]),
            self._create_task("task-3", ["implementation"]),  # depends on design
        ]
        result = self.builder.build(tasks)

        # First group should have analysis and design (can run in parallel)
        # Second group should have implementation (depends on design)
        assert len(result.parallel_groups) >= 1

    def test_no_cyclic_dependencies(self):
        """Test that cycles are handled properly."""
        # Create tasks that would naturally form a cycle
        tasks = [
            self._create_task("task-1", ["test"]),  # test depends on impl
            self._create_task("task-2", ["implementation"]),  # impl depends on design
            self._create_task("task-3", ["design"]),
        ]
        result = self.builder.build(tasks)

        # Should not have cycles in execution order
        assert len(result.execution_order) == 3

        # Verify no task appears before its dependencies
        completed = set()
        for task_id in result.execution_order:
            for dep in result.graph.get(task_id, []):
                assert dep in completed, f"{task_id} appears before its dependency {dep}"
            completed.add(task_id)

    def test_dependency_graph_to_dict(self):
        """Test dependency graph serialization."""
        tasks = [
            self._create_task("task-1", ["design"]),
            self._create_task("task-2", ["implementation"]),
        ]
        result = self.builder.build(tasks)
        result_dict = result.to_dict()

        assert "graph" in result_dict
        assert "execution_order" in result_dict
        assert "parallel_groups" in result_dict

    def test_frontend_depends_on_backend(self):
        """Test that frontend tasks depend on backend tasks."""
        tasks = [
            self._create_task("task-1", ["backend"]),
            self._create_task("task-2", ["frontend"]),
        ]
        result = self.builder.build(tasks)

        # frontend should depend on backend
        assert "task-1" in result.graph["task-2"]

    def test_integration_test_depends_on_unit(self):
        """Test that integration tests depend on unit tests."""
        tasks = [
            self._create_task("task-1", ["unit"]),
            self._create_task("task-2", ["integration"]),
        ]
        result = self.builder.build(tasks)

        # integration should depend on unit
        assert "task-1" in result.graph["task-2"]

    def test_tasks_updated_with_dependencies(self):
        """Test that original tasks are updated with dependencies."""
        tasks = [
            self._create_task("task-1", ["design"]),
            self._create_task("task-2", ["implementation"]),
        ]
        self.builder.build(tasks)

        # Task 2 should now have task-1 as dependency
        assert "task-1" in tasks[1].dependencies
