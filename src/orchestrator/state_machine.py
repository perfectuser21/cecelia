"""State machine for Orchestrator - TRD, Task, Run state transitions."""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from src.orchestrator.models import (
    TRD,
    TRDStatus,
    Task,
    TaskStatus,
    Run,
    RunStatus,
)


class StateTransitionError(Exception):
    """Raised when an invalid state transition is attempted."""
    pass


class StateMachine:
    """State machine for managing TRD, Task, and Run state transitions."""

    # TRD valid transitions
    TRD_TRANSITIONS: Dict[TRDStatus, List[TRDStatus]] = {
        TRDStatus.DRAFT: [TRDStatus.PLANNED, TRDStatus.CANCELLED],
        TRDStatus.PLANNED: [TRDStatus.IN_PROGRESS, TRDStatus.CANCELLED],
        TRDStatus.IN_PROGRESS: [TRDStatus.DONE, TRDStatus.BLOCKED, TRDStatus.CANCELLED],
        TRDStatus.BLOCKED: [TRDStatus.IN_PROGRESS, TRDStatus.CANCELLED],
        TRDStatus.DONE: [],
        TRDStatus.CANCELLED: [],
    }

    # Task valid transitions
    TASK_TRANSITIONS: Dict[TaskStatus, List[TaskStatus]] = {
        TaskStatus.QUEUED: [TaskStatus.ASSIGNED, TaskStatus.BLOCKED, TaskStatus.CANCELLED],
        TaskStatus.ASSIGNED: [TaskStatus.RUNNING, TaskStatus.QUEUED, TaskStatus.CANCELLED],
        TaskStatus.RUNNING: [TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.BLOCKED, TaskStatus.CANCELLED],
        TaskStatus.BLOCKED: [TaskStatus.QUEUED, TaskStatus.CANCELLED],
        TaskStatus.FAILED: [TaskStatus.QUEUED, TaskStatus.CANCELLED],  # retry
        TaskStatus.DONE: [],
        TaskStatus.CANCELLED: [],
    }

    # Run valid transitions (only forward, no rollback)
    RUN_TRANSITIONS: Dict[RunStatus, List[RunStatus]] = {
        RunStatus.RUNNING: [RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.TIMEOUT, RunStatus.CANCELLED],
        RunStatus.SUCCESS: [],
        RunStatus.FAILED: [],
        RunStatus.TIMEOUT: [],
        RunStatus.CANCELLED: [],
    }

    def __init__(
        self,
        blocked_threshold_minutes: int = 60,
        max_retries: int = 3,
    ):
        """Initialize state machine.

        Args:
            blocked_threshold_minutes: Time threshold for TRD blocked detection
            max_retries: Maximum retry attempts for failed tasks
        """
        self.blocked_threshold = timedelta(minutes=blocked_threshold_minutes)
        self.max_retries = max_retries

    # ==================== TRD State Transitions ====================

    def can_transition_trd(self, trd: TRD, new_status: TRDStatus) -> bool:
        """Check if TRD can transition to new status."""
        return new_status in self.TRD_TRANSITIONS.get(trd.status, [])

    def transition_trd(self, trd: TRD, new_status: TRDStatus) -> TRD:
        """Transition TRD to new status.

        Args:
            trd: TRD to transition
            new_status: Target status

        Returns:
            Updated TRD

        Raises:
            StateTransitionError: If transition is invalid
        """
        if not self.can_transition_trd(trd, new_status):
            raise StateTransitionError(
                f"Cannot transition TRD from {trd.status.value} to {new_status.value}"
            )

        trd.status = new_status
        trd.updated_at = datetime.now()

        if new_status == TRDStatus.PLANNED:
            trd.planned_at = datetime.now()
        elif new_status == TRDStatus.DONE:
            trd.completed_at = datetime.now()

        return trd

    def plan_trd(self, trd: TRD, tasks: List[Task]) -> Tuple[TRD, List[Task]]:
        """Transition TRD from draft to planned with tasks.

        Args:
            trd: TRD to plan
            tasks: Tasks generated from planning

        Returns:
            Tuple of (updated TRD, tasks)
        """
        if trd.status != TRDStatus.DRAFT:
            raise StateTransitionError(f"Can only plan TRD in draft status, got {trd.status.value}")

        # Set trd_id on all tasks
        for task in tasks:
            task.trd_id = trd.id

        trd = self.transition_trd(trd, TRDStatus.PLANNED)
        return trd, tasks

    # ==================== Task State Transitions ====================

    def can_transition_task(self, task: Task, new_status: TaskStatus) -> bool:
        """Check if Task can transition to new status."""
        return new_status in self.TASK_TRANSITIONS.get(task.status, [])

    def transition_task(self, task: Task, new_status: TaskStatus) -> Task:
        """Transition Task to new status.

        Args:
            task: Task to transition
            new_status: Target status

        Returns:
            Updated Task

        Raises:
            StateTransitionError: If transition is invalid
        """
        if not self.can_transition_task(task, new_status):
            raise StateTransitionError(
                f"Cannot transition Task from {task.status.value} to {new_status.value}"
            )

        task.status = new_status
        task.updated_at = datetime.now()

        if new_status == TaskStatus.RUNNING:
            task.started_at = datetime.now()
        elif new_status == TaskStatus.DONE:
            task.completed_at = datetime.now()
        elif new_status == TaskStatus.BLOCKED:
            task.blocked_at = datetime.now()

        return task

    def assign_task(self, task: Task, worker_id: str) -> Task:
        """Assign task to worker.

        Args:
            task: Task to assign
            worker_id: Worker ID

        Returns:
            Updated Task
        """
        if task.status != TaskStatus.QUEUED:
            raise StateTransitionError(f"Can only assign queued tasks, got {task.status.value}")

        task.worker_id = worker_id
        return self.transition_task(task, TaskStatus.ASSIGNED)

    def start_task(self, task: Task) -> Task:
        """Start task execution.

        Args:
            task: Task to start

        Returns:
            Updated Task
        """
        if task.status != TaskStatus.ASSIGNED:
            raise StateTransitionError(f"Can only start assigned tasks, got {task.status.value}")

        return self.transition_task(task, TaskStatus.RUNNING)

    def complete_task(self, task: Task, pr_url: Optional[str] = None) -> Task:
        """Mark task as done.

        Args:
            task: Task to complete
            pr_url: Optional PR URL

        Returns:
            Updated Task
        """
        if pr_url:
            task.pr_url = pr_url
        return self.transition_task(task, TaskStatus.DONE)

    def fail_task(self, task: Task, error: Optional[str] = None) -> Task:
        """Mark task as failed.

        Args:
            task: Task to fail
            error: Optional error message

        Returns:
            Updated Task
        """
        if error:
            task.blocked_reason = error
        return self.transition_task(task, TaskStatus.FAILED)

    def block_task(self, task: Task, reason: str) -> Task:
        """Block task with reason.

        Args:
            task: Task to block
            reason: Blocking reason

        Returns:
            Updated Task
        """
        task.blocked_reason = reason
        return self.transition_task(task, TaskStatus.BLOCKED)

    def retry_task(self, task: Task) -> Task:
        """Retry failed task.

        Args:
            task: Task to retry

        Returns:
            Updated Task

        Raises:
            StateTransitionError: If max retries exceeded
        """
        if task.status != TaskStatus.FAILED:
            raise StateTransitionError(f"Can only retry failed tasks, got {task.status.value}")

        if task.retry_count >= task.max_retries:
            raise StateTransitionError(
                f"Max retries ({task.max_retries}) exceeded for task {task.id}"
            )

        task.retry_count += 1
        task.worker_id = None
        task.blocked_reason = None
        return self.transition_task(task, TaskStatus.QUEUED)

    def unblock_task(self, task: Task) -> Task:
        """Unblock a blocked task.

        Args:
            task: Task to unblock

        Returns:
            Updated Task
        """
        if task.status != TaskStatus.BLOCKED:
            raise StateTransitionError(f"Can only unblock blocked tasks, got {task.status.value}")

        task.blocked_reason = None
        task.blocked_at = None
        return self.transition_task(task, TaskStatus.QUEUED)

    # ==================== Run State Transitions ====================

    def can_transition_run(self, run: Run, new_status: RunStatus) -> bool:
        """Check if Run can transition to new status."""
        return new_status in self.RUN_TRANSITIONS.get(run.status, [])

    def transition_run(self, run: Run, new_status: RunStatus, error: Optional[str] = None) -> Run:
        """Transition Run to new status.

        Args:
            run: Run to transition
            new_status: Target status
            error: Optional error message

        Returns:
            Updated Run

        Raises:
            StateTransitionError: If transition is invalid
        """
        if not self.can_transition_run(run, new_status):
            raise StateTransitionError(
                f"Cannot transition Run from {run.status.value} to {new_status.value}"
            )

        run.complete(new_status, error)
        return run

    # ==================== Tick - State Machine Driver ====================

    def tick(
        self,
        trds: List[TRD],
        tasks: List[Task],
        runs: List[Run],
    ) -> Dict[str, Any]:
        """Tick the state machine - advance states based on current conditions.

        Args:
            trds: All TRDs
            tasks: All Tasks
            runs: All Runs

        Returns:
            Dict with lists of updated TRDs, Tasks, and Runs
        """
        updated_trds: List[TRD] = []
        updated_tasks: List[Task] = []
        retried_tasks: List[Task] = []
        unblocked_tasks: List[Task] = []

        # Build lookup maps
        tasks_by_trd: Dict[str, List[Task]] = {}
        for task in tasks:
            tasks_by_trd.setdefault(task.trd_id, []).append(task)

        # 1. Check TRD completion
        for trd in trds:
            if trd.status == TRDStatus.IN_PROGRESS:
                trd_tasks = tasks_by_trd.get(trd.id, [])
                if trd_tasks and all(t.status == TaskStatus.DONE for t in trd_tasks):
                    self.transition_trd(trd, TRDStatus.DONE)
                    updated_trds.append(trd)

        # 2. Check TRD blocked (any task blocked over threshold)
        for trd in trds:
            if trd.status == TRDStatus.IN_PROGRESS:
                trd_tasks = tasks_by_trd.get(trd.id, [])
                for task in trd_tasks:
                    if task.status == TaskStatus.BLOCKED and task.blocked_at:
                        blocked_duration = datetime.now() - task.blocked_at
                        if blocked_duration > self.blocked_threshold:
                            self.transition_trd(trd, TRDStatus.BLOCKED)
                            updated_trds.append(trd)
                            break

        # 3. Auto-retry failed tasks
        for task in tasks:
            if task.status == TaskStatus.FAILED and task.retry_count < task.max_retries:
                try:
                    self.retry_task(task)
                    retried_tasks.append(task)
                except StateTransitionError:
                    pass

        # 4. Unlock dependencies
        done_task_ids = {t.id for t in tasks if t.status == TaskStatus.DONE}
        for task in tasks:
            if task.status == TaskStatus.QUEUED and task.depends_on:
                # Remove completed dependencies
                remaining_deps = [d for d in task.depends_on if d not in done_task_ids]
                if remaining_deps != task.depends_on:
                    task.depends_on = remaining_deps
                    task.updated_at = datetime.now()
                    unblocked_tasks.append(task)

        # 5. Start TRDs that have tasks starting
        for trd in trds:
            if trd.status == TRDStatus.PLANNED:
                trd_tasks = tasks_by_trd.get(trd.id, [])
                if any(t.status in [TaskStatus.ASSIGNED, TaskStatus.RUNNING] for t in trd_tasks):
                    self.transition_trd(trd, TRDStatus.IN_PROGRESS)
                    updated_trds.append(trd)

        return {
            "updated_trds": updated_trds,
            "updated_tasks": updated_tasks + retried_tasks + unblocked_tasks,
            "retried_tasks": retried_tasks,
            "unblocked_tasks": unblocked_tasks,
        }

    # ==================== Helpers ====================

    def get_ready_tasks(self, tasks: List[Task]) -> List[Task]:
        """Get tasks that are ready to execute (queued with no pending dependencies).

        Args:
            tasks: All tasks

        Returns:
            List of ready tasks, sorted by priority
        """
        done_task_ids = {t.id for t in tasks if t.status == TaskStatus.DONE}
        ready = []

        for task in tasks:
            if task.status == TaskStatus.QUEUED:
                pending_deps = [d for d in task.depends_on if d not in done_task_ids]
                if not pending_deps:
                    ready.append(task)

        # Sort by priority (P0 > P1 > P2)
        priority_order = {"P0": 0, "P1": 1, "P2": 2}
        ready.sort(key=lambda t: (priority_order.get(t.priority, 99), t.created_at))

        return ready

    def validate_no_cycles(self, tasks: List[Task]) -> Tuple[bool, List[str]]:
        """Validate that task dependencies have no cycles.

        Args:
            tasks: Tasks to validate

        Returns:
            Tuple of (is_valid, cycle_task_ids)
        """
        task_ids = {t.id for t in tasks}
        graph = {t.id: t.depends_on for t in tasks}

        # Topological sort with cycle detection
        visited = set()
        rec_stack = set()
        cycle_nodes = []

        def dfs(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)

            for dep in graph.get(node, []):
                if dep not in task_ids:
                    continue  # Skip non-existent dependencies
                if dep not in visited:
                    if dfs(dep):
                        return True
                elif dep in rec_stack:
                    cycle_nodes.append(dep)
                    return True

            rec_stack.remove(node)
            return False

        for task_id in task_ids:
            if task_id not in visited:
                if dfs(task_id):
                    return False, cycle_nodes

        return True, []
