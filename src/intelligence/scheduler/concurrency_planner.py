"""Concurrency Planner - Plan parallel task execution."""

from dataclasses import dataclass
from typing import Dict, List, Set

from src.intelligence.scheduler.priority_calculator import TaskInput


@dataclass
class ExecutionPhase:
    """A phase of task execution."""

    phase: int
    tasks: List[str]
    concurrent: bool
    reason: str


@dataclass
class ExecutionPlan:
    """Complete execution plan."""

    phases: List[ExecutionPhase]
    critical_path: List[str]
    estimated_total_time: str
    visualization: str


class ConcurrencyPlanner:
    """Plans concurrent task execution respecting dependencies."""

    def __init__(self, max_concurrent: int = 3):
        """Initialize planner.

        Args:
            max_concurrent: Maximum number of concurrent tasks
        """
        self.max_concurrent = max_concurrent

    def plan(
        self,
        tasks: List[TaskInput],
        execution_order: List[str],
        must_finish_first: List[str] = None,
    ) -> ExecutionPlan:
        """Create an execution plan with parallel phases.

        Args:
            tasks: List of tasks
            execution_order: Topologically sorted task IDs
            must_finish_first: Tasks that must complete before others

        Returns:
            ExecutionPlan with phases
        """
        must_finish_first = must_finish_first or []
        task_map = {t.id: t for t in tasks}

        phases: List[ExecutionPhase] = []
        completed: Set[str] = set()
        remaining = set(execution_order)
        phase_num = 1

        while remaining:
            # Find all tasks ready to run
            ready: List[str] = []
            for task_id in remaining:
                task = task_map.get(task_id)
                if task:
                    deps_met = all(dep in completed for dep in task.dependencies)
                    if deps_met:
                        ready.append(task_id)

            if not ready:
                break

            # Handle must_finish_first constraint
            must_first_ready = [t for t in ready if t in must_finish_first and t not in completed]
            if must_first_ready:
                # Execute must_finish_first tasks one at a time
                task_id = must_first_ready[0]
                phases.append(ExecutionPhase(
                    phase=phase_num,
                    tasks=[task_id],
                    concurrent=False,
                    reason="必须先完成",
                ))
                completed.add(task_id)
                remaining.discard(task_id)
            else:
                # Sort ready tasks by priority
                ready.sort(key=lambda tid: (
                    {"P0": 0, "P1": 1, "P2": 2}.get(task_map[tid].priority, 2),
                    tid,
                ))

                # Limit to max_concurrent
                batch = ready[:self.max_concurrent]
                concurrent = len(batch) > 1

                # Generate reason
                if len(batch) == 1:
                    task = task_map[batch[0]]
                    if task.dependencies:
                        deps_str = ", ".join(task.dependencies)
                        reason = f"依赖 {deps_str}"
                    else:
                        reason = "无依赖"
                else:
                    reason = f"{len(batch)} 个任务可并行"

                phases.append(ExecutionPhase(
                    phase=phase_num,
                    tasks=batch,
                    concurrent=concurrent,
                    reason=reason,
                ))

                for task_id in batch:
                    completed.add(task_id)
                    remaining.discard(task_id)

            phase_num += 1

        # Calculate critical path and total time
        critical_path = self._find_critical_path(tasks, task_map)
        total_time = self._estimate_total_time(phases, task_map)
        visualization = self._generate_visualization(phases)

        return ExecutionPlan(
            phases=phases,
            critical_path=critical_path,
            estimated_total_time=total_time,
            visualization=visualization,
        )

    def _find_critical_path(
        self,
        tasks: List[TaskInput],
        task_map: Dict[str, TaskInput],
    ) -> List[str]:
        """Find the critical path through tasks."""
        # Simple approach: find longest dependency chain
        longest_path: Dict[str, List[str]] = {}

        for task in tasks:
            longest_path[task.id] = [task.id]

        # Build paths
        for task in tasks:
            for dep_id in task.dependencies:
                if dep_id in longest_path:
                    candidate = longest_path[dep_id] + [task.id]
                    if len(candidate) > len(longest_path[task.id]):
                        longest_path[task.id] = candidate

        # Return longest
        result: List[str] = []
        for path in longest_path.values():
            if len(path) > len(result):
                result = path

        return result

    def _estimate_total_time(
        self,
        phases: List[ExecutionPhase],
        task_map: Dict[str, TaskInput],
    ) -> str:
        """Estimate total execution time."""
        total_minutes = 0

        for phase in phases:
            # For concurrent phases, use max time
            phase_times = []
            for task_id in phase.tasks:
                task = task_map.get(task_id)
                if task and task.estimated_time:
                    minutes = self._parse_time(task.estimated_time)
                    phase_times.append(minutes)

            if phase_times:
                if phase.concurrent:
                    total_minutes += max(phase_times)
                else:
                    total_minutes += sum(phase_times)

        # Format output
        if total_minutes >= 60:
            hours = total_minutes / 60
            return f"{hours:.1f}h"
        return f"{total_minutes}min"

    def _parse_time(self, time_str: str) -> int:
        """Parse time string to minutes."""
        time_str = time_str.lower().strip()
        if "h" in time_str:
            hours = float(time_str.replace("h", ""))
            return int(hours * 60)
        elif "min" in time_str:
            return int(time_str.replace("min", ""))
        return 30  # Default

    def _generate_visualization(self, phases: List[ExecutionPhase]) -> str:
        """Generate ASCII visualization of execution plan."""
        if not phases:
            return ""

        parts = []
        for phase in phases:
            if len(phase.tasks) == 1:
                parts.append(phase.tasks[0])
            else:
                parts.append(f"[{', '.join(phase.tasks)}]")

        return " → ".join(parts)
