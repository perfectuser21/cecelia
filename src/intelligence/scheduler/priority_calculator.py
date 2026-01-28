"""Priority Calculator - Calculate dynamic task priorities."""

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class TaskInput:
    """Input task for scheduling."""

    id: str
    priority: str  # P0, P1, P2
    dependencies: List[str]
    title: str = ""
    estimated_time: str = ""


class PriorityCalculator:
    """Calculates and adjusts task priorities dynamically."""

    # Priority weights (lower = higher priority)
    PRIORITY_WEIGHTS = {
        "P0": 0,
        "P1": 1,
        "P2": 2,
    }

    def calculate_effective_priority(
        self,
        task: TaskInput,
        all_tasks: Dict[str, TaskInput],
    ) -> int:
        """Calculate effective priority considering dependencies.

        A task's effective priority is influenced by:
        1. Its own priority
        2. The priorities of tasks that depend on it (blockers get higher priority)

        Args:
            task: The task to calculate priority for
            all_tasks: Dictionary of all tasks by ID

        Returns:
            Effective priority score (lower = higher priority)
        """
        base_priority = self.PRIORITY_WEIGHTS.get(task.priority, 2)

        # Check if this task blocks high-priority tasks
        blocker_bonus = 0
        for other_task in all_tasks.values():
            if task.id in other_task.dependencies:
                other_priority = self.PRIORITY_WEIGHTS.get(other_task.priority, 2)
                if other_priority < base_priority:
                    # This task blocks a higher priority task
                    blocker_bonus = min(blocker_bonus, other_priority - base_priority)

        return base_priority + blocker_bonus

    def sort_by_priority(
        self,
        tasks: List[TaskInput],
    ) -> List[TaskInput]:
        """Sort tasks by priority (P0 first, then P1, then P2).

        Args:
            tasks: List of tasks to sort

        Returns:
            Sorted list of tasks
        """
        all_tasks = {t.id: t for t in tasks}

        return sorted(
            tasks,
            key=lambda t: (
                self.calculate_effective_priority(t, all_tasks),
                t.id,  # Stable sort by ID
            ),
        )

    def group_by_priority(
        self,
        tasks: List[TaskInput],
    ) -> Dict[str, List[TaskInput]]:
        """Group tasks by their priority level.

        Args:
            tasks: List of tasks to group

        Returns:
            Dictionary with priority keys and task lists
        """
        groups: Dict[str, List[TaskInput]] = {
            "P0": [],
            "P1": [],
            "P2": [],
        }

        for task in tasks:
            priority = task.priority if task.priority in groups else "P2"
            groups[priority].append(task)

        return groups
