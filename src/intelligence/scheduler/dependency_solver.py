"""Dependency Solver - Topological sort and dependency resolution."""

from dataclasses import dataclass
from typing import Dict, List, Tuple

from src.intelligence.scheduler.priority_calculator import TaskInput


@dataclass
class DependencyResult:
    """Result of dependency solving."""

    execution_order: List[str]
    has_cycle: bool
    cycle_tasks: List[str]


class DependencySolver:
    """Solves task dependencies using topological sort."""

    def solve(
        self,
        tasks: List[TaskInput],
    ) -> DependencyResult:
        """Solve dependencies and return execution order.

        Uses Kahn's algorithm for topological sort.

        Args:
            tasks: List of tasks with dependencies

        Returns:
            DependencyResult with execution order
        """
        # Build adjacency list and in-degree map
        graph: Dict[str, List[str]] = {t.id: [] for t in tasks}
        in_degree: Dict[str, int] = {t.id: 0 for t in tasks}
        task_map = {t.id: t for t in tasks}

        # Build graph edges (dependency -> dependent)
        for task in tasks:
            for dep_id in task.dependencies:
                if dep_id in graph:
                    graph[dep_id].append(task.id)
                    in_degree[task.id] += 1

        # Find all tasks with no dependencies
        queue = [task_id for task_id, degree in in_degree.items() if degree == 0]

        # Sort queue by priority for consistent ordering
        queue.sort(key=lambda tid: (
            {"P0": 0, "P1": 1, "P2": 2}.get(task_map[tid].priority, 2),
            tid,
        ))

        execution_order: List[str] = []

        while queue:
            # Pop task with highest priority
            current = queue.pop(0)
            execution_order.append(current)

            # Update in-degrees
            for dependent in graph[current]:
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    queue.append(dependent)
                    # Re-sort to maintain priority order
                    queue.sort(key=lambda tid: (
                        {"P0": 0, "P1": 1, "P2": 2}.get(task_map[tid].priority, 2),
                        tid,
                    ))

        # Check for cycles
        has_cycle = len(execution_order) != len(tasks)
        cycle_tasks: List[str] = []

        if has_cycle:
            # Find tasks involved in cycle
            cycle_tasks = [
                task_id for task_id in in_degree
                if in_degree[task_id] > 0
            ]

        return DependencyResult(
            execution_order=execution_order,
            has_cycle=has_cycle,
            cycle_tasks=cycle_tasks,
        )

    def find_critical_path(
        self,
        tasks: List[TaskInput],
        execution_order: List[str],
    ) -> List[str]:
        """Find the critical path (longest dependency chain).

        Args:
            tasks: List of tasks
            execution_order: Topologically sorted task IDs

        Returns:
            List of task IDs forming the critical path
        """
        task_map = {t.id: t for t in tasks}

        # Calculate longest path to each task
        longest_path: Dict[str, List[str]] = {t.id: [t.id] for t in tasks}

        for task_id in execution_order:
            task = task_map[task_id]
            for dep_id in task.dependencies:
                if dep_id in longest_path:
                    candidate_path = longest_path[dep_id] + [task_id]
                    if len(candidate_path) > len(longest_path[task_id]):
                        longest_path[task_id] = candidate_path

        # Find the longest path overall
        critical_path: List[str] = []
        for path in longest_path.values():
            if len(path) > len(critical_path):
                critical_path = path

        return critical_path

    def detect_cycle(
        self,
        tasks: List[TaskInput],
    ) -> Tuple[bool, List[str]]:
        """Detect if there's a cycle in the dependency graph.

        Args:
            tasks: List of tasks

        Returns:
            Tuple of (has_cycle, cycle_tasks)
        """
        result = self.solve(tasks)
        return result.has_cycle, result.cycle_tasks
