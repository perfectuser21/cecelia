"""Executor for Orchestrator - Actually runs tasks via Claude.

This module provides:
1. Resource monitoring (memory, CPU, concurrent processes)
2. Worker pool management
3. Task execution via headless Claude
"""

import asyncio
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.autumnrice.models import Task, generate_run_id


# Constants
HOME = Path.home()
CLAUDE_PATH = HOME / ".local" / "bin" / "claude"
MEMORY_PER_SEAT_GB = 1.5  # Reserve 1.5GB per seat (reduced from 2.0)
MEMORY_SYSTEM_RESERVE_GB = 2.0  # Reserve 2GB for system
MAX_SEATS_HARD_LIMIT = 6  # Never exceed 6 concurrent seats
MIN_MEMORY_TO_SPAWN_GB = 2.0  # Need at least 2GB free to spawn
LOAD_AVERAGE_THRESHOLD = 6.0  # Pause spawning if load > this
DEFAULT_TASK_TIMEOUT = 1800  # 30 minutes


@dataclass
class SeatStatus:
    """Status of a single seat (execution slot)."""
    seat_id: int
    status: str  # idle, running, paused
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    project: Optional[str] = None
    started_at: Optional[str] = None


@dataclass
class ResourceStatus:
    """Current system resource status with dynamic seat calculation."""
    memory_total_gb: float
    memory_available_gb: float
    memory_per_seat_gb: float = MEMORY_PER_SEAT_GB
    cpu_count: int = 1
    load_average: float = 0.0
    claude_processes: int = 0
    max_seats: int = 6
    active_seats: int = 0
    available_seats: int = 6
    can_spawn_more: bool = True
    throttle_reason: Optional[str] = None
    seats: List[SeatStatus] = None

    def __post_init__(self):
        if self.seats is None:
            self.seats = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "memory_total_gb": round(self.memory_total_gb, 2),
            "memory_available_gb": round(self.memory_available_gb, 2),
            "memory_per_seat_gb": self.memory_per_seat_gb,
            "cpu_count": self.cpu_count,
            "load_average": round(self.load_average, 2),
            "claude_processes": self.claude_processes,
            "max_seats": self.max_seats,
            "active_seats": self.active_seats,
            "available_seats": self.available_seats,
            "can_spawn_more": self.can_spawn_more,
            "throttle_reason": self.throttle_reason,
            "seats": [
                {
                    "seat_id": s.seat_id,
                    "status": s.status,
                    "task_id": s.task_id,
                    "task_title": s.task_title,
                    "project": s.project,
                    "started_at": s.started_at,
                }
                for s in self.seats
            ],
        }


@dataclass
class ExecutionResult:
    """Result of task execution."""
    success: bool
    task_id: str
    run_id: str
    status: str  # success, failed, timeout
    output: str = ""
    error: str = ""
    duration_seconds: int = 0
    pr_url: Optional[str] = None


def get_resource_status(active_seats: int = 0, seat_info: List[SeatStatus] = None) -> ResourceStatus:
    """Get current system resource status with dynamic seat calculation.

    Args:
        active_seats: Number of seats currently in use
        seat_info: Optional list of current seat statuses

    Returns:
        ResourceStatus with system info and seat calculations
    """
    # Get memory info
    try:
        with open("/proc/meminfo", "r") as f:
            meminfo = f.read()

        mem_total = 0
        mem_available = 0
        for line in meminfo.split("\n"):
            if line.startswith("MemTotal:"):
                mem_total = int(line.split()[1]) / 1024 / 1024  # KB to GB
            elif line.startswith("MemAvailable:"):
                mem_available = int(line.split()[1]) / 1024 / 1024  # KB to GB
    except Exception:
        mem_total = 16.0
        mem_available = 8.0

    # Get CPU count
    try:
        cpu_count = os.cpu_count() or 1
    except Exception:
        cpu_count = 1

    # Get load average
    try:
        with open("/proc/loadavg", "r") as f:
            load_info = f.read()
        load_average = float(load_info.split()[0])  # 1-minute load average
    except Exception:
        load_average = 0.0

    # Count Claude processes
    try:
        result = subprocess.run(
            ["pgrep", "-c", "-f", "claude"],
            capture_output=True,
            text=True,
            timeout=5
        )
        claude_processes = int(result.stdout.strip()) if result.returncode == 0 else 0
    except Exception:
        claude_processes = 0

    # Dynamic seat calculation
    # 1. Based on available memory: (available - 2GB reserve) / 1.5GB per seat
    available_for_seats = max(0, mem_available - MEMORY_SYSTEM_RESERVE_GB)
    max_by_memory = int(available_for_seats / MEMORY_PER_SEAT_GB)

    # 2. Based on CPU: 1 seat per 1.5 CPUs
    max_by_cpu = int(cpu_count / 1.5)

    # 3. Take minimum, capped at hard limit
    max_seats = min(max_by_memory, max_by_cpu, MAX_SEATS_HARD_LIMIT)
    max_seats = max(1, max_seats) if mem_available > MIN_MEMORY_TO_SPAWN_GB else 0

    # Determine if we can spawn more and why not
    can_spawn = True
    throttle_reason = None

    if active_seats >= max_seats:
        can_spawn = False
        throttle_reason = f"All {max_seats} seats occupied"
    elif mem_available < MIN_MEMORY_TO_SPAWN_GB:
        can_spawn = False
        throttle_reason = f"Low memory: {mem_available:.1f}GB available (need {MIN_MEMORY_TO_SPAWN_GB}GB)"
    elif load_average > LOAD_AVERAGE_THRESHOLD:
        can_spawn = False
        throttle_reason = f"High load: {load_average:.2f} (threshold: {LOAD_AVERAGE_THRESHOLD})"

    # Build seat status list
    seats = seat_info or []
    # Fill in idle seats up to max_seats
    existing_seat_ids = {s.seat_id for s in seats}
    for i in range(1, max_seats + 1):
        if i not in existing_seat_ids:
            seats.append(SeatStatus(seat_id=i, status="idle"))
    seats = sorted(seats, key=lambda s: s.seat_id)[:max_seats]

    available_seats = max_seats - active_seats

    return ResourceStatus(
        memory_total_gb=mem_total,
        memory_available_gb=mem_available,
        cpu_count=cpu_count,
        load_average=load_average,
        claude_processes=claude_processes,
        max_seats=max_seats,
        active_seats=active_seats,
        available_seats=available_seats,
        can_spawn_more=can_spawn,
        throttle_reason=throttle_reason,
        seats=seats,
    )


class Executor:
    """Executor that manages seats and runs tasks via Claude."""

    def __init__(self, max_seats: Optional[int] = None):
        """Initialize executor.

        Args:
            max_seats: Max concurrent seats (None = auto based on resources)
        """
        self.max_seats_override = max_seats
        self._running_tasks: Dict[str, asyncio.subprocess.Process] = {}
        self._task_info: Dict[str, Dict[str, Any]] = {}  # task_id -> {title, project, started_at}
        self._results: Dict[str, ExecutionResult] = {}

    @property
    def active_seats(self) -> int:
        """Get number of currently active seats."""
        return len(self._running_tasks)

    def _get_seat_info(self) -> List[SeatStatus]:
        """Get current seat statuses for running tasks."""
        seats = []
        for i, (task_id, _) in enumerate(self._running_tasks.items(), start=1):
            info = self._task_info.get(task_id, {})
            seats.append(SeatStatus(
                seat_id=i,
                status="running",
                task_id=task_id,
                task_title=info.get("title"),
                project=info.get("project"),
                started_at=info.get("started_at"),
            ))
        return seats

    def get_resources(self) -> ResourceStatus:
        """Get current resource status with seat information."""
        return get_resource_status(self.active_seats, self._get_seat_info())

    def get_seats(self) -> Dict[str, Any]:
        """Get seats status as a dict for API response."""
        return self.get_resources().to_dict()

    def can_execute(self) -> bool:
        """Check if we can execute more tasks (have available seats)."""
        resources = self.get_resources()
        if self.max_seats_override:
            return self.active_seats < self.max_seats_override and resources.can_spawn_more
        return resources.can_spawn_more

    async def execute_task(
        self,
        task: Task,
        timeout: int = DEFAULT_TASK_TIMEOUT,
    ) -> ExecutionResult:
        """Execute a single task.

        Args:
            task: Task to execute
            timeout: Timeout in seconds

        Returns:
            ExecutionResult
        """
        run_id = generate_run_id()
        start_time = datetime.now()

        # Build prompt from task
        prompt = self._build_prompt(task)

        # Create temporary PRD file for the task
        prd_file = Path(f"/tmp/autumnrice_task_{task.id}.md")
        try:
            prd_file.write_text(prompt)
        except Exception as e:
            return ExecutionResult(
                success=False,
                task_id=task.id,
                run_id=run_id,
                status="failed",
                error=f"Failed to write PRD file: {e}",
            )

        try:
            # Run Claude with /dev skill
            process = await asyncio.create_subprocess_exec(
                str(CLAUDE_PATH),
                "-p", f"/dev {prd_file}",
                "--model", "sonnet",
                "--output-format", "json",
                "--allowed-tools", "Bash,Read,Write,Edit,Glob,Grep",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(HOME / "dev" / task.repo) if task.repo else str(HOME / "dev"),
            )

            self._running_tasks[task.id] = process
            self._task_info[task.id] = {
                "title": task.title,
                "project": task.repo,
                "started_at": start_time.isoformat(),
            }

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout
                )

                duration = int((datetime.now() - start_time).total_seconds())

                if process.returncode == 0:
                    # Parse output for PR URL
                    output_text = stdout.decode("utf-8", errors="replace")
                    pr_url = self._extract_pr_url(output_text)

                    return ExecutionResult(
                        success=True,
                        task_id=task.id,
                        run_id=run_id,
                        status="success",
                        output=output_text[:5000],  # Truncate
                        duration_seconds=duration,
                        pr_url=pr_url,
                    )
                else:
                    return ExecutionResult(
                        success=False,
                        task_id=task.id,
                        run_id=run_id,
                        status="failed",
                        error=stderr.decode("utf-8", errors="replace")[:2000],
                        duration_seconds=duration,
                    )

            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return ExecutionResult(
                    success=False,
                    task_id=task.id,
                    run_id=run_id,
                    status="timeout",
                    error=f"Task timed out after {timeout} seconds",
                    duration_seconds=timeout,
                )

        except Exception as e:
            return ExecutionResult(
                success=False,
                task_id=task.id,
                run_id=run_id,
                status="failed",
                error=str(e),
            )

        finally:
            # Cleanup
            self._running_tasks.pop(task.id, None)
            self._task_info.pop(task.id, None)
            try:
                prd_file.unlink()
            except Exception:
                pass

    def _build_prompt(self, task: Task) -> str:
        """Build PRD prompt for task.

        Args:
            task: Task to build prompt for

        Returns:
            PRD content string
        """
        if task.prd_content:
            return task.prd_content

        # Build minimal PRD from task info
        prd = f"""---
id: task-{task.id}
version: 1.0.0
created: {datetime.now().strftime('%Y-%m-%d')}
---

# PRD: {task.title}

## 功能描述

{task.description}

## 成功标准

"""
        for i, criterion in enumerate(task.acceptance, 1):
            prd += f"{i}. {criterion}\n"

        if not task.acceptance:
            prd += "1. 功能实现完成\n2. 测试通过\n3. 构建通过\n"

        return prd

    def _extract_pr_url(self, output: str) -> Optional[str]:
        """Extract PR URL from Claude output.

        Args:
            output: Claude output text

        Returns:
            PR URL if found
        """
        import re
        # Look for GitHub PR URLs
        match = re.search(r'https://github\.com/[^/]+/[^/]+/pull/\d+', output)
        return match.group(0) if match else None

    async def execute_batch(
        self,
        tasks: List[Task],
        max_concurrent: Optional[int] = None,
    ) -> List[ExecutionResult]:
        """Execute multiple tasks with dynamic seat-based concurrency control.

        Args:
            tasks: Tasks to execute
            max_concurrent: Max concurrent executions (None = auto based on seats)

        Returns:
            List of ExecutionResults
        """
        if not tasks:
            return []

        # Determine concurrency based on available seats
        resources = self.get_resources()
        concurrent = max_concurrent or self.max_seats_override or resources.max_seats
        concurrent = max(1, min(concurrent, len(tasks), MAX_SEATS_HARD_LIMIT))

        results = []
        semaphore = asyncio.Semaphore(concurrent)

        async def run_with_semaphore(task: Task) -> ExecutionResult:
            async with semaphore:
                return await self.execute_task(task)

        # Run all tasks with semaphore
        results = await asyncio.gather(
            *[run_with_semaphore(task) for task in tasks],
            return_exceptions=True
        )

        # Convert exceptions to ExecutionResults
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                final_results.append(ExecutionResult(
                    success=False,
                    task_id=tasks[i].id,
                    run_id=generate_run_id(),
                    status="failed",
                    error=str(result),
                ))
            else:
                final_results.append(result)

        return final_results


# Singleton executor instance
_executor: Optional[Executor] = None


def get_executor() -> Executor:
    """Get or create the global executor instance."""
    global _executor
    if _executor is None:
        _executor = Executor()
    return _executor
