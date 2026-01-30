"""Data models for Orchestrator - TRD, Task, Run."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import uuid4


class TRDStatus(str, Enum):
    """TRD status enum."""
    DRAFT = "draft"
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"
    CANCELLED = "cancelled"


class TaskStatus(str, Enum):
    """Task status enum."""
    QUEUED = "queued"
    ASSIGNED = "assigned"
    RUNNING = "running"
    BLOCKED = "blocked"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RunStatus(str, Enum):
    """Run status enum."""
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


def generate_trd_id() -> str:
    """Generate TRD ID: TRD-YYYY-MM-DD-NNN."""
    today = datetime.now().strftime("%Y-%m-%d")
    suffix = str(uuid4())[:3].upper()
    return f"TRD-{today}-{suffix}"


def generate_task_id() -> str:
    """Generate Task ID: T-NNNNNN."""
    return f"T-{str(uuid4())[:6].upper()}"


def generate_run_id() -> str:
    """Generate Run ID: R-NNNNNNNN."""
    return f"R-{str(uuid4())[:8].upper()}"


@dataclass
class TRD:
    """Technical Requirement Document - High-level requirement."""

    id: str = field(default_factory=generate_trd_id)
    title: str = ""
    description: str = ""
    kr_id: Optional[str] = None
    status: TRDStatus = TRDStatus.DRAFT
    projects: List[str] = field(default_factory=list)
    acceptance_criteria: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    planned_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "kr_id": self.kr_id,
            "status": self.status.value,
            "projects": self.projects,
            "acceptance_criteria": self.acceptance_criteria,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "planned_at": self.planned_at.isoformat() if self.planned_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TRD":
        """Create from dictionary."""
        return cls(
            id=data.get("id", generate_trd_id()),
            title=data.get("title", ""),
            description=data.get("description", ""),
            kr_id=data.get("kr_id"),
            status=TRDStatus(data.get("status", "draft")),
            projects=data.get("projects", []),
            acceptance_criteria=data.get("acceptance_criteria", []),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else datetime.now(),
            planned_at=datetime.fromisoformat(data["planned_at"]) if data.get("planned_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
        )


@dataclass
class Task:
    """Executable task - Small unit of work."""

    id: str = field(default_factory=generate_task_id)
    trd_id: str = ""
    title: str = ""
    description: str = ""
    repo: str = ""
    branch: str = ""
    status: TaskStatus = TaskStatus.QUEUED
    priority: str = "P1"
    depends_on: List[str] = field(default_factory=list)
    acceptance: List[str] = field(default_factory=list)
    prd_content: str = ""
    pr_url: Optional[str] = None
    worker_id: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    blocked_reason: Optional[str] = None
    blocked_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    @property
    def is_ready(self) -> bool:
        """Check if task is ready to execute (no pending dependencies)."""
        return self.status == TaskStatus.QUEUED and len(self.depends_on) == 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "trd_id": self.trd_id,
            "title": self.title,
            "description": self.description,
            "repo": self.repo,
            "branch": self.branch,
            "status": self.status.value,
            "priority": self.priority,
            "depends_on": self.depends_on,
            "acceptance": self.acceptance,
            "prd_content": self.prd_content,
            "pr_url": self.pr_url,
            "worker_id": self.worker_id,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "blocked_reason": self.blocked_reason,
            "blocked_at": self.blocked_at.isoformat() if self.blocked_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        """Create from dictionary."""
        return cls(
            id=data.get("id", generate_task_id()),
            trd_id=data.get("trd_id", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            repo=data.get("repo", ""),
            branch=data.get("branch", ""),
            status=TaskStatus(data.get("status", "queued")),
            priority=data.get("priority", "P1"),
            depends_on=data.get("depends_on", []),
            acceptance=data.get("acceptance", []),
            prd_content=data.get("prd_content", ""),
            pr_url=data.get("pr_url"),
            worker_id=data.get("worker_id"),
            retry_count=data.get("retry_count", 0),
            max_retries=data.get("max_retries", 3),
            blocked_reason=data.get("blocked_reason"),
            blocked_at=datetime.fromisoformat(data["blocked_at"]) if data.get("blocked_at") else None,
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else datetime.now(),
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
        )


@dataclass
class Run:
    """Execution record - One attempt to complete a task."""

    id: str = field(default_factory=generate_run_id)
    task_id: str = ""
    attempt: int = 1
    status: RunStatus = RunStatus.RUNNING
    worker_id: str = ""
    log_file: Optional[str] = None
    pr_url: Optional[str] = None
    ci_status: Optional[str] = None
    ci_run_id: Optional[str] = None
    error: Optional[str] = None
    started_at: datetime = field(default_factory=datetime.now)
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None

    def complete(self, status: RunStatus, error: Optional[str] = None) -> None:
        """Mark run as complete."""
        self.status = status
        self.ended_at = datetime.now()
        self.duration_seconds = int((self.ended_at - self.started_at).total_seconds())
        if error:
            self.error = error

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "task_id": self.task_id,
            "attempt": self.attempt,
            "status": self.status.value,
            "worker_id": self.worker_id,
            "log_file": self.log_file,
            "pr_url": self.pr_url,
            "ci_status": self.ci_status,
            "ci_run_id": self.ci_run_id,
            "error": self.error,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "duration_seconds": self.duration_seconds,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Run":
        """Create from dictionary."""
        return cls(
            id=data.get("id", generate_run_id()),
            task_id=data.get("task_id", ""),
            attempt=data.get("attempt", 1),
            status=RunStatus(data.get("status", "running")),
            worker_id=data.get("worker_id", ""),
            log_file=data.get("log_file"),
            pr_url=data.get("pr_url"),
            ci_status=data.get("ci_status"),
            ci_run_id=data.get("ci_run_id"),
            error=data.get("error"),
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else datetime.now(),
            ended_at=datetime.fromisoformat(data["ended_at"]) if data.get("ended_at") else None,
            duration_seconds=data.get("duration_seconds"),
        )
