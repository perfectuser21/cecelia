"""Dependency Builder - Build task dependency graphs."""

from dataclasses import dataclass
from typing import Any, Dict, List, Set, Tuple

from src.intelligence.parser.task_decomposer import Task


@dataclass
class DependencyGraph:
    """A dependency graph for tasks."""

    graph: Dict[str, List[str]]  # task_id -> list of dependency task_ids
    execution_order: List[str]  # Topologically sorted task IDs
    parallel_groups: List[List[str]]  # Groups of tasks that can run in parallel

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "graph": self.graph,
            "execution_order": self.execution_order,
            "parallel_groups": self.parallel_groups,
        }


class DependencyBuilder:
    """Builds dependency graphs for task lists."""

    # Tag-based dependency rules: tasks with these tags should come before tasks with dependent tags
    TAG_DEPENDENCIES = {
        "implementation": ["design", "analysis"],
        "frontend": ["api", "backend"],
        "test": ["implementation", "fix", "refactor"],
        "e2e": ["unit", "integration"],
        "integration": ["unit"],
        "docs": ["implementation", "test"],
        "deployment": ["test", "implementation"],
        "css": ["ui"],
        "validation": ["api"],
        "regression": ["fix"],
    }

    def build(self, tasks: List[Task]) -> DependencyGraph:
        """Build a dependency graph from a list of tasks.

        Args:
            tasks: List of tasks to build dependencies for

        Returns:
            DependencyGraph with execution order and parallel groups
        """
        # Initialize empty graph
        graph: Dict[str, List[str]] = {task.id: [] for task in tasks}

        # Build dependencies based on tags
        task_tags = {task.id: set(task.tags) for task in tasks}

        for task in tasks:
            deps = self._find_dependencies(task, tasks, task_tags)
            graph[task.id] = deps
            task.dependencies = deps

        # Check for cycles
        if self._has_cycle(graph):
            # Remove cycle-causing edges
            graph = self._remove_cycles(graph)

        # Topological sort
        execution_order = self._topological_sort(graph)

        # Find parallel groups
        parallel_groups = self._find_parallel_groups(graph, execution_order)

        return DependencyGraph(
            graph=graph,
            execution_order=execution_order,
            parallel_groups=parallel_groups,
        )

    def _find_dependencies(
        self,
        task: Task,
        all_tasks: List[Task],
        task_tags: Dict[str, Set[str]],
    ) -> List[str]:
        """Find dependencies for a task based on tags."""
        dependencies = []

        for other_task in all_tasks:
            if other_task.id == task.id:
                continue

            # Check if other_task should come before this task
            for tag in task.tags:
                required_tags = self.TAG_DEPENDENCIES.get(tag, [])
                for req_tag in required_tags:
                    if req_tag in task_tags[other_task.id]:
                        if other_task.id not in dependencies:
                            dependencies.append(other_task.id)
                        break

        return dependencies

    def _has_cycle(self, graph: Dict[str, List[str]]) -> bool:
        """Check if the graph has a cycle using DFS."""
        visited: Set[str] = set()
        rec_stack: Set[str] = set()

        def dfs(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)

            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    if dfs(neighbor):
                        return True
                elif neighbor in rec_stack:
                    return True

            rec_stack.remove(node)
            return False

        for node in graph:
            if node not in visited:
                if dfs(node):
                    return True

        return False

    def _remove_cycles(self, graph: Dict[str, List[str]]) -> Dict[str, List[str]]:
        """Remove edges that cause cycles."""
        # Simple approach: remove back edges found during DFS
        new_graph = {k: list(v) for k, v in graph.items()}
        visited: Set[str] = set()
        rec_stack: Set[str] = set()
        edges_to_remove: List[Tuple[str, str]] = []

        def dfs(node: str) -> None:
            visited.add(node)
            rec_stack.add(node)

            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    dfs(neighbor)
                elif neighbor in rec_stack:
                    # Found a back edge, mark for removal
                    edges_to_remove.append((node, neighbor))

            rec_stack.remove(node)

        for node in graph:
            if node not in visited:
                dfs(node)

        # Remove back edges
        for from_node, to_node in edges_to_remove:
            if to_node in new_graph[from_node]:
                new_graph[from_node].remove(to_node)

        return new_graph

    def _topological_sort(self, graph: Dict[str, List[str]]) -> List[str]:
        """Perform topological sort on the graph."""
        in_degree = {node: 0 for node in graph}

        # Calculate in-degrees
        for node in graph:
            for dep in graph[node]:
                if dep in in_degree:
                    in_degree[node] += 1

        # Start with nodes that have no dependencies
        queue = [node for node in graph if in_degree[node] == 0]
        result = []

        while queue:
            # Sort by task number to maintain consistent ordering
            queue.sort(key=lambda x: int(x.split("-")[1]) if "-" in x else 0)
            node = queue.pop(0)
            result.append(node)

            # Reduce in-degree for nodes that depend on this one
            for other_node in graph:
                if node in graph[other_node]:
                    in_degree[other_node] -= 1
                    if in_degree[other_node] == 0:
                        queue.append(other_node)

        return result

    def _find_parallel_groups(
        self,
        graph: Dict[str, List[str]],
        execution_order: List[str],
    ) -> List[List[str]]:
        """Find groups of tasks that can run in parallel."""
        groups: List[List[str]] = []
        completed: Set[str] = set()

        remaining = set(execution_order)

        while remaining:
            # Find all tasks whose dependencies are completed
            ready = []
            for task_id in remaining:
                deps = graph.get(task_id, [])
                if all(dep in completed for dep in deps):
                    ready.append(task_id)

            if not ready:
                # No more tasks can be scheduled (shouldn't happen with valid graph)
                break

            # Sort for consistent ordering
            ready.sort(key=lambda x: int(x.split("-")[1]) if "-" in x else 0)

            groups.append(ready)

            # Mark as completed
            for task_id in ready:
                completed.add(task_id)
                remaining.remove(task_id)

        return groups
