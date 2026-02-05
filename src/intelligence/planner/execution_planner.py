"""Execution Planner - Plan and visualize task execution."""

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class TaskStats:
    """Statistics about tasks."""

    total: int
    by_priority: Dict[str, int]
    by_status: Dict[str, int]


@dataclass
class Bottleneck:
    """A bottleneck in the execution plan."""

    task_id: str
    reason: str
    suggestion: str
    blocked_count: int


@dataclass
class ExecutionPlan:
    """Current execution plan state."""

    next_up: List[str]
    in_progress: List[str]
    waiting: List[str]
    blocked: List[str]


@dataclass
class PlannerResult:
    """Result of planning."""

    current_tasks: TaskStats
    execution_plan: ExecutionPlan
    estimated_completion: str
    bottlenecks: List[Bottleneck]
    risks: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "current_tasks": {
                "total": self.current_tasks.total,
                "by_priority": self.current_tasks.by_priority,
                "by_status": self.current_tasks.by_status,
            },
            "execution_plan": {
                "next_up": self.execution_plan.next_up,
                "in_progress": self.execution_plan.in_progress,
                "waiting": self.execution_plan.waiting,
                "blocked": self.execution_plan.blocked,
            },
            "estimated_completion": self.estimated_completion,
            "bottlenecks": [
                {
                    "task": b.task_id,
                    "reason": b.reason,
                    "suggestion": b.suggestion,
                }
                for b in self.bottlenecks
            ],
            "risks": self.risks,
        }


@dataclass
class TaskInput:
    """Input task for planning."""

    id: str
    priority: str = "P1"
    status: str = "queued"
    dependencies: List[str] = field(default_factory=list)
    estimated_time: str = "30min"
    blocked_by: List[str] = field(default_factory=list)


class ExecutionPlanner:
    """Plans task execution and identifies bottlenecks."""

    def __init__(self, max_concurrent: int = 3):
        """Initialize planner.

        Args:
            max_concurrent: Maximum concurrent tasks
        """
        self.max_concurrent = max_concurrent

    def plan(self, tasks: List[Dict[str, Any]]) -> PlannerResult:
        """Generate execution plan for tasks.

        Args:
            tasks: List of task dictionaries

        Returns:
            PlannerResult with plan and analysis
        """
        # Convert to TaskInput
        task_inputs = [
            TaskInput(
                id=t["id"],
                priority=t.get("priority", "P1"),
                status=t.get("status", "queued"),
                dependencies=t.get("dependencies", []),
                estimated_time=t.get("estimated_time", "30min"),
                blocked_by=t.get("blocked_by", []),
            )
            for t in tasks
        ]

        # Calculate statistics
        stats = self._calculate_stats(task_inputs)

        # Build execution plan
        execution_plan = self._build_execution_plan(task_inputs)

        # Find bottlenecks
        bottlenecks = self._find_bottlenecks(task_inputs)

        # Estimate completion time
        estimated_time = self._estimate_completion(task_inputs)

        return PlannerResult(
            current_tasks=stats,
            execution_plan=execution_plan,
            estimated_completion=estimated_time,
            bottlenecks=bottlenecks,
            risks=[],
        )

    def _calculate_stats(self, tasks: List[TaskInput]) -> TaskStats:
        """Calculate task statistics.

        Args:
            tasks: List of tasks

        Returns:
            TaskStats with counts
        """
        by_priority: Dict[str, int] = {"P0": 0, "P1": 0, "P2": 0}
        by_status: Dict[str, int] = {
            "queued": 0,
            "in_progress": 0,
            "completed": 0,
            "blocked": 0,
        }

        for task in tasks:
            # Count by priority
            if task.priority in by_priority:
                by_priority[task.priority] += 1

            # Count by status
            if task.status in by_status:
                by_status[task.status] += 1

        return TaskStats(
            total=len(tasks),
            by_priority=by_priority,
            by_status=by_status,
        )

    def _build_execution_plan(self, tasks: List[TaskInput]) -> ExecutionPlan:
        """Build execution plan.

        Args:
            tasks: List of tasks

        Returns:
            ExecutionPlan with categorized tasks
        """
        task_map = {t.id: t for t in tasks}
        completed_ids = {t.id for t in tasks if t.status == "completed"}

        in_progress: List[str] = []
        next_up: List[str] = []
        waiting: List[str] = []
        blocked: List[str] = []

        for task in tasks:
            if task.status == "completed":
                continue

            if task.status == "in_progress":
                in_progress.append(task.id)
                continue

            # Check if dependencies are met
            deps_met = all(
                dep in completed_ids
                for dep in task.dependencies
            )

            # Check if blocked by other tasks
            is_blocked = any(
                blocker not in completed_ids
                for blocker in task.blocked_by
            )

            if is_blocked:
                blocked.append(task.id)
            elif deps_met:
                # Can be scheduled
                if len(next_up) < self.max_concurrent - len(in_progress):
                    next_up.append(task.id)
                else:
                    waiting.append(task.id)
            else:
                waiting.append(task.id)

        # Sort next_up by priority
        next_up.sort(key=lambda tid: (
            {"P0": 0, "P1": 1, "P2": 2}.get(task_map[tid].priority, 2),
            tid,
        ))

        return ExecutionPlan(
            next_up=next_up,
            in_progress=in_progress,
            waiting=waiting,
            blocked=blocked,
        )

    def _find_bottlenecks(self, tasks: List[TaskInput]) -> List[Bottleneck]:
        """Find bottleneck tasks.

        Args:
            tasks: List of tasks

        Returns:
            List of bottlenecks
        """
        bottlenecks: List[Bottleneck] = []
        task_map = {t.id: t for t in tasks}

        # Count how many tasks each task blocks
        blocks_count: Dict[str, int] = {t.id: 0 for t in tasks}
        for task in tasks:
            for dep in task.dependencies:
                if dep in blocks_count:
                    blocks_count[dep] += 1

        # Find tasks that block many others
        for task_id, count in blocks_count.items():
            if count >= 3:  # Blocks 3 or more tasks
                task = task_map.get(task_id)
                if task and task.status != "completed":
                    bottlenecks.append(Bottleneck(
                        task_id=task_id,
                        reason=f"阻塞了 {count} 个后续任务",
                        suggestion="优先完成此任务",
                        blocked_count=count,
                    ))

        # Sort by blocked count
        bottlenecks.sort(key=lambda b: b.blocked_count, reverse=True)

        return bottlenecks

    def _estimate_completion(self, tasks: List[TaskInput]) -> str:
        """Estimate total completion time.

        Args:
            tasks: List of tasks

        Returns:
            Estimated time string
        """
        total_minutes = 0

        for task in tasks:
            if task.status == "completed":
                continue

            minutes = self._parse_time(task.estimated_time)
            total_minutes += minutes

        # Account for parallelism
        effective_minutes = total_minutes / min(self.max_concurrent, len(tasks) or 1)

        # Format output
        if effective_minutes >= 60:
            hours = effective_minutes / 60
            return f"{hours:.1f}h"
        return f"{int(effective_minutes)}min"

    def _parse_time(self, time_str: str) -> int:
        """Parse time string to minutes.

        Args:
            time_str: Time string like "1h" or "30min"

        Returns:
            Minutes as integer
        """
        time_str = time_str.lower().strip()
        if "h" in time_str:
            hours = float(time_str.replace("h", ""))
            return int(hours * 60)
        elif "min" in time_str:
            return int(time_str.replace("min", ""))
        return 30  # Default

    def get_summary(self, tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Get a summary of the current plan.

        Args:
            tasks: List of task dictionaries

        Returns:
            Summary dictionary
        """
        result = self.plan(tasks)
        return result.to_dict()
