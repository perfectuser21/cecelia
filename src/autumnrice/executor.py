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
MEMORY_PER_WORKER_GB = 2.0  # Reserve 2GB per worker
MAX_WORKERS_HARD_LIMIT = 5  # Never exceed this
DEFAULT_TASK_TIMEOUT = 1800  # 30 minutes


@dataclass
class ResourceStatus:
    """Current system resource status."""
    memory_total_gb: float
    memory_available_gb: float
    memory_per_worker_gb: float = MEMORY_PER_WORKER_GB
    cpu_count: int = 1
    claude_processes: int = 0
    max_workers: int = 3
    current_workers: int = 0
    can_spawn_more: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "memory_total_gb": round(self.memory_total_gb, 2),
            "memory_available_gb": round(self.memory_available_gb, 2),
            "memory_per_worker_gb": self.memory_per_worker_gb,
            "cpu_count": self.cpu_count,
            "claude_processes": self.claude_processes,
            "max_workers": self.max_workers,
            "current_workers": self.current_workers,
            "can_spawn_more": self.can_spawn_more,
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


def get_resource_status(current_workers: int = 0) -> ResourceStatus:
    """Get current system resource status.

    Args:
        current_workers: Number of workers currently running

    Returns:
        ResourceStatus with system info
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

    # Calculate max workers based on available memory
    # Leave 2GB for system, rest for workers
    available_for_workers = max(0, mem_available - 2.0)
    max_by_memory = int(available_for_workers / MEMORY_PER_WORKER_GB)

    # Also limit by CPU (1 worker per 2 CPUs)
    max_by_cpu = cpu_count // 2

    # Take minimum, but at least 1 if we have resources
    max_workers = min(max_by_memory, max_by_cpu, MAX_WORKERS_HARD_LIMIT)
    max_workers = max(1, max_workers) if mem_available > MEMORY_PER_WORKER_GB else 0

    can_spawn = current_workers < max_workers and mem_available > MEMORY_PER_WORKER_GB

    return ResourceStatus(
        memory_total_gb=mem_total,
        memory_available_gb=mem_available,
        cpu_count=cpu_count,
        claude_processes=claude_processes,
        max_workers=max_workers,
        current_workers=current_workers,
        can_spawn_more=can_spawn,
    )


class Executor:
    """Executor that actually runs tasks via Claude."""

    def __init__(self, max_concurrent: Optional[int] = None):
        """Initialize executor.

        Args:
            max_concurrent: Max concurrent workers (None = auto based on resources)
        """
        self.max_concurrent = max_concurrent
        self._running_tasks: Dict[str, asyncio.subprocess.Process] = {}
        self._results: Dict[str, ExecutionResult] = {}

    @property
    def current_workers(self) -> int:
        """Get number of currently running workers."""
        return len(self._running_tasks)

    def get_resources(self) -> ResourceStatus:
        """Get current resource status."""
        return get_resource_status(self.current_workers)

    def can_execute(self) -> bool:
        """Check if we can execute more tasks."""
        resources = self.get_resources()
        if self.max_concurrent:
            return self.current_workers < self.max_concurrent and resources.can_spawn_more
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
        """Execute multiple tasks with concurrency control.

        Args:
            tasks: Tasks to execute
            max_concurrent: Max concurrent executions (None = auto)

        Returns:
            List of ExecutionResults
        """
        if not tasks:
            return []

        # Determine concurrency
        resources = self.get_resources()
        concurrent = max_concurrent or self.max_concurrent or resources.max_workers
        concurrent = max(1, min(concurrent, len(tasks), MAX_WORKERS_HARD_LIMIT))

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
