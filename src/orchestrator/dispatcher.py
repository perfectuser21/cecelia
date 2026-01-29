"""Dispatcher for Orchestrator - Select and assign tasks to workers."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.orchestrator.models import Task, Run, generate_run_id
from src.orchestrator.state_machine import StateMachine


@dataclass
class Worker:
    """Worker that can execute tasks."""
    id: str
    name: str
    status: str = "idle"  # idle, busy
    current_task_id: Optional[str] = None
    last_heartbeat: datetime = field(default_factory=datetime.now)
    capabilities: List[str] = field(default_factory=list)


@dataclass
class DispatchResult:
    """Result of dispatch operation."""
    success: bool
    task: Optional[Task] = None
    run: Optional[Run] = None
    worker: Optional[Worker] = None
    error: Optional[str] = None


class Dispatcher:
    """Dispatcher for selecting and assigning tasks to workers."""

    def __init__(
        self,
        state_machine: Optional[StateMachine] = None,
        max_concurrent_per_worker: int = 1,
    ):
        """Initialize dispatcher.

        Args:
            state_machine: State machine instance
            max_concurrent_per_worker: Max concurrent tasks per worker
        """
        self.state_machine = state_machine or StateMachine()
        self.max_concurrent = max_concurrent_per_worker
        self.workers: Dict[str, Worker] = {}

    def register_worker(self, worker_id: str, name: str, capabilities: Optional[List[str]] = None) -> Worker:
        """Register a new worker.

        Args:
            worker_id: Worker ID
            name: Worker name
            capabilities: Worker capabilities

        Returns:
            Registered worker
        """
        worker = Worker(
            id=worker_id,
            name=name,
            capabilities=capabilities or [],
        )
        self.workers[worker_id] = worker
        return worker

    def update_worker_heartbeat(self, worker_id: str) -> Optional[Worker]:
        """Update worker heartbeat.

        Args:
            worker_id: Worker ID

        Returns:
            Updated worker or None
        """
        if worker_id in self.workers:
            self.workers[worker_id].last_heartbeat = datetime.now()
            return self.workers[worker_id]
        return None

    def get_idle_workers(self) -> List[Worker]:
        """Get list of idle workers.

        Returns:
            List of idle workers
        """
        return [w for w in self.workers.values() if w.status == "idle"]

    def get_next_task(self, tasks: List[Task]) -> Optional[Task]:
        """Get next task to execute.

        Args:
            tasks: All tasks

        Returns:
            Next task to execute or None
        """
        ready_tasks = self.state_machine.get_ready_tasks(tasks)
        return ready_tasks[0] if ready_tasks else None

    def dispatch(
        self,
        tasks: List[Task],
        worker_id: Optional[str] = None,
    ) -> DispatchResult:
        """Dispatch a task to a worker.

        Args:
            tasks: All tasks
            worker_id: Specific worker ID (optional, will auto-select if not provided)

        Returns:
            DispatchResult with task, run, and worker info
        """
        # Get next task
        task = self.get_next_task(tasks)
        if not task:
            return DispatchResult(
                success=False,
                error="No ready tasks available",
            )

        # Get worker
        if worker_id:
            worker = self.workers.get(worker_id)
            if not worker:
                return DispatchResult(
                    success=False,
                    error=f"Worker {worker_id} not found",
                )
            if worker.status != "idle":
                return DispatchResult(
                    success=False,
                    error=f"Worker {worker_id} is busy",
                )
        else:
            idle_workers = self.get_idle_workers()
            if not idle_workers:
                return DispatchResult(
                    success=False,
                    error="No idle workers available",
                )
            worker = idle_workers[0]

        # Assign task to worker
        try:
            self.state_machine.assign_task(task, worker.id)
        except Exception as e:
            return DispatchResult(
                success=False,
                error=f"Failed to assign task: {str(e)}",
            )

        # Update worker status
        worker.status = "busy"
        worker.current_task_id = task.id

        # Create run record
        run = Run(
            id=generate_run_id(),
            task_id=task.id,
            attempt=task.retry_count + 1,
            worker_id=worker.id,
        )

        return DispatchResult(
            success=True,
            task=task,
            run=run,
            worker=worker,
        )

    def release_worker(self, worker_id: str) -> Optional[Worker]:
        """Release worker back to idle.

        Args:
            worker_id: Worker ID

        Returns:
            Updated worker or None
        """
        if worker_id in self.workers:
            worker = self.workers[worker_id]
            worker.status = "idle"
            worker.current_task_id = None
            return worker
        return None

    def get_dispatch_summary(self, tasks: List[Task]) -> Dict[str, Any]:
        """Get summary of dispatch status.

        Args:
            tasks: All tasks

        Returns:
            Summary dict
        """
        ready_tasks = self.state_machine.get_ready_tasks(tasks)
        idle_workers = self.get_idle_workers()

        by_status = {}
        for task in tasks:
            status = task.status.value
            by_status[status] = by_status.get(status, 0) + 1

        return {
            "total_tasks": len(tasks),
            "ready_tasks": len(ready_tasks),
            "idle_workers": len(idle_workers),
            "total_workers": len(self.workers),
            "tasks_by_status": by_status,
            "can_dispatch": len(ready_tasks) > 0 and len(idle_workers) > 0,
        }
