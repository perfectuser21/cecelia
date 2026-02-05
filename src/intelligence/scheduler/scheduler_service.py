"""Scheduler Service - Orchestrates scheduling components."""

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from src.intelligence.scheduler.priority_calculator import PriorityCalculator, TaskInput
from src.intelligence.scheduler.dependency_solver import DependencySolver
from src.intelligence.scheduler.concurrency_planner import ConcurrencyPlanner


@dataclass
class ScheduleResult:
    """Result of scheduling tasks."""

    execution_plan: Dict[str, Any]
    visualization: str
    schedule_time_ms: float
    has_cycle: bool
    cycle_tasks: List[str]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "execution_plan": self.execution_plan,
            "visualization": self.visualization,
            "schedule_time_ms": self.schedule_time_ms,
            "has_cycle": self.has_cycle,
            "cycle_tasks": self.cycle_tasks,
        }


class SchedulerService:
    """Main service for task scheduling."""

    def __init__(self, max_concurrent: int = 3):
        """Initialize scheduler service.

        Args:
            max_concurrent: Maximum concurrent tasks
        """
        self.priority_calculator = PriorityCalculator()
        self.dependency_solver = DependencySolver()
        self.concurrency_planner = ConcurrencyPlanner(max_concurrent=max_concurrent)

    def schedule(
        self,
        tasks: List[Dict[str, Any]],
        constraints: Optional[Dict[str, Any]] = None,
    ) -> ScheduleResult:
        """Schedule a list of tasks.

        Args:
            tasks: List of task dictionaries with id, priority, dependencies
            constraints: Optional constraints (max_concurrent, must_finish_first)

        Returns:
            ScheduleResult with execution plan
        """
        start_time = time.time()
        constraints = constraints or {}

        # Convert to TaskInput objects
        task_inputs = [
            TaskInput(
                id=t["id"],
                priority=t.get("priority", "P1"),
                dependencies=t.get("dependencies", []),
                title=t.get("title", ""),
                estimated_time=t.get("estimated_time", "30min"),
            )
            for t in tasks
        ]

        # Check for cycles
        dep_result = self.dependency_solver.solve(task_inputs)

        if dep_result.has_cycle:
            schedule_time_ms = (time.time() - start_time) * 1000
            return ScheduleResult(
                execution_plan={
                    "phases": [],
                    "estimated_total_time": "N/A",
                    "critical_path": [],
                    "error": "Circular dependency detected",
                },
                visualization="",
                schedule_time_ms=round(schedule_time_ms, 2),
                has_cycle=True,
                cycle_tasks=dep_result.cycle_tasks,
            )

        # Update max_concurrent if specified
        max_concurrent = constraints.get("max_concurrent", 3)
        self.concurrency_planner.max_concurrent = max_concurrent

        # Get must_finish_first constraint
        must_finish_first = constraints.get("must_finish_first", [])

        # Create execution plan
        plan = self.concurrency_planner.plan(
            tasks=task_inputs,
            execution_order=dep_result.execution_order,
            must_finish_first=must_finish_first,
        )

        # Calculate critical path
        critical_path = self.dependency_solver.find_critical_path(
            task_inputs,
            dep_result.execution_order,
        )

        schedule_time_ms = (time.time() - start_time) * 1000

        return ScheduleResult(
            execution_plan={
                "phases": [
                    {
                        "phase": p.phase,
                        "tasks": p.tasks,
                        "concurrent": p.concurrent,
                        "reason": p.reason,
                    }
                    for p in plan.phases
                ],
                "estimated_total_time": plan.estimated_total_time,
                "critical_path": critical_path,
            },
            visualization=plan.visualization,
            schedule_time_ms=round(schedule_time_ms, 2),
            has_cycle=False,
            cycle_tasks=[],
        )
