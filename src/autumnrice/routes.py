"""API routes for Autumnrice (秋米) - Task execution engine.

秋米是 Cecelia 的管家/调度 Agent，负责：
1. 接收 PRD，分解成 Tasks
2. 调度执行（/dev 或 N8N workflow）
3. 状态回流和护栏保护

护栏功能:
1. 幂等与去重 - idempotency_key
2. 状态回流 - /status, /latest 端点
3. Tick 锁 - 文件锁防止并发
4. 失败策略 - retry_count + max_retries
"""

import fcntl
import json
import os
import tempfile
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.autumnrice.models import (
    TRD,
    TRDStatus,
    Task,
    TaskStatus,
    Run,
    RunStatus,
)
from src.autumnrice.state_machine import StateMachine, StateTransitionError
from src.autumnrice.planner import Planner
from src.autumnrice.dispatcher import Dispatcher, Worker
from src.autumnrice.executor import get_executor
from src.db.pool import Database

router = APIRouter(prefix="/autumnrice", tags=["autumnrice"])

# Database dependency - will be set by main.py
_db: Optional[Database] = None

# Shared instances (stateless, safe to keep in memory)
_state_machine = StateMachine()
_planner = Planner()
_dispatcher = Dispatcher(state_machine=_state_machine)


def set_database(db: Database) -> None:
    """Set the database instance for routes."""
    global _db
    _db = db


def get_db() -> Database:
    """Get the database instance."""
    if _db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")
    return _db


async def ensure_tables(db: Database) -> None:
    """Create/migrate tables for unified Autumnrice data model.

    This function:
    1. Extends existing projects table with trd_content
    2. Extends existing tasks table with execution fields
    3. Creates feature_prds table for PRD version management
    4. Creates legacy orchestrator tables for backwards compatibility
    """
    # ==================== Unified Model Extensions ====================

    # Extend projects table with TRD content field
    await db.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'projects' AND column_name = 'trd_content'
            ) THEN
                ALTER TABLE projects ADD COLUMN trd_content TEXT DEFAULT '';
            END IF;
        END $$;
        """
    )

    # Extend tasks table with execution fields for Autumnrice
    task_columns = [
        ("branch", "TEXT DEFAULT ''"),
        ("pr_url", "TEXT"),
        ("checkpoints", "JSONB DEFAULT '[]'"),
        ("run_id", "TEXT"),
        ("attempt", "INT DEFAULT 1"),
        ("max_retries", "INT DEFAULT 3"),
        ("retry_count", "INT DEFAULT 0"),
        ("blocked_reason", "TEXT"),
        ("blocked_at", "TIMESTAMPTZ"),
        ("ci_status", "TEXT"),
        ("ci_run_id", "TEXT"),
        ("prd_content", "TEXT DEFAULT ''"),
        ("acceptance", "JSONB DEFAULT '[]'"),
        ("depends_on", "JSONB DEFAULT '[]'"),
        ("repo", "TEXT DEFAULT ''"),
        ("duration", "INT"),  # Execution duration in seconds
        ("error", "TEXT"),  # Error message if failed
    ]
    for col_name, col_type in task_columns:
        await db.execute(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tasks' AND column_name = '{col_name}'
                ) THEN
                    ALTER TABLE tasks ADD COLUMN {col_name} {col_type};
                END IF;
            END $$;
            """
        )

    # Create feature_prds table for PRD version management
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS feature_prds (
            id TEXT PRIMARY KEY,
            feature_id UUID REFERENCES projects(id),
            version TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_feature_prds_feature ON feature_prds(feature_id)"
    )

    # Note: Legacy tables (trds, tasks, orchestrator_runs, orchestrator_workers)
    # have been removed. All data now uses unified projects/tasks tables.


# ==================== Request/Response Models ====================

class CreateTRDRequest(BaseModel):
    """Request to create a TRD."""
    title: str
    description: str = ""
    kr_id: Optional[str] = None
    projects: List[str] = []
    acceptance_criteria: List[str] = []
    idempotency_key: Optional[str] = None  # 护栏 1


class TRDResponse(BaseModel):
    """TRD response."""
    id: str
    title: str
    description: str
    kr_id: Optional[str]
    status: str
    projects: List[str]
    acceptance_criteria: List[str]
    created_at: str
    updated_at: str
    planned_at: Optional[str]
    completed_at: Optional[str]


class PlanTRDRequest(BaseModel):
    """Request to plan a TRD."""
    context: Optional[Dict[str, Any]] = None


class TaskResponse(BaseModel):
    """Task response."""
    id: str
    trd_id: str
    title: str
    description: str
    repo: str
    branch: str
    status: str
    priority: str
    depends_on: List[str]
    acceptance: List[str]
    pr_url: Optional[str]
    worker_id: Optional[str]
    retry_count: int
    blocked_reason: Optional[str]
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]


class StartTaskRequest(BaseModel):
    """Request to start a task."""
    worker_id: str
    log_file: Optional[str] = None


class RunResponse(BaseModel):
    """Run response."""
    id: str
    task_id: str
    attempt: int
    status: str
    worker_id: str
    log_file: Optional[str]
    pr_url: Optional[str]
    ci_status: Optional[str]
    ci_run_id: Optional[str]
    error: Optional[str]
    started_at: str
    ended_at: Optional[str]
    duration_seconds: Optional[int]


class CompleteRunRequest(BaseModel):
    """Request to complete a run."""
    status: str  # success, failed, timeout
    pr_url: Optional[str] = None
    ci_status: Optional[str] = None
    ci_run_id: Optional[str] = None
    error: Optional[str] = None


class TickResponse(BaseModel):
    """Response from tick operation."""
    updated_trds: List[str] = []
    updated_tasks: List[str] = []
    retried_tasks: List[str] = []
    unblocked_tasks: List[str] = []
    skipped: Optional[str] = None  # 护栏 3
    progress_summary: Optional[str] = None  # 护栏 2


class RegisterWorkerRequest(BaseModel):
    """Request to register a worker."""
    name: str
    capabilities: List[str] = []


class WorkerResponse(BaseModel):
    """Worker response."""
    id: str
    name: str
    status: str
    current_task_id: Optional[str]
    last_heartbeat: str
    capabilities: List[str]


# ==================== DB Helper Functions ====================

def _row_to_trd(row) -> TRD:
    """Convert DB row to TRD object."""
    projects = row["projects"] if isinstance(row["projects"], list) else json.loads(row["projects"] or "[]")
    acceptance = row["acceptance_criteria"] if isinstance(row["acceptance_criteria"], list) else json.loads(row["acceptance_criteria"] or "[]")
    return TRD(
        id=row["id"],
        title=row["title"],
        description=row["description"] or "",
        kr_id=row["kr_id"],
        status=TRDStatus(row["status"]),
        projects=projects,
        acceptance_criteria=acceptance,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        planned_at=row["planned_at"],
        completed_at=row["completed_at"],
    )


def _row_to_task(row) -> Task:
    """Convert DB row to Task object."""
    depends_on = row["depends_on"] if isinstance(row["depends_on"], list) else json.loads(row["depends_on"] or "[]")
    acceptance = row["acceptance"] if isinstance(row["acceptance"], list) else json.loads(row["acceptance"] or "[]")
    return Task(
        id=row["id"],
        trd_id=row["trd_id"] or "",
        title=row["title"],
        description=row["description"] or "",
        repo=row["repo"] or "",
        branch=row["branch"] or "",
        status=TaskStatus(row["status"]),
        priority=row["priority"] or "P1",
        depends_on=depends_on,
        acceptance=acceptance,
        prd_content=row["prd_content"] or "",
        pr_url=row["pr_url"],
        worker_id=row["worker_id"],
        retry_count=row["retry_count"] or 0,
        max_retries=row["max_retries"] or 3,
        blocked_reason=row["blocked_reason"],
        blocked_at=row["blocked_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


def _row_to_run(row) -> Run:
    """Convert DB row to Run object."""
    return Run(
        id=row["id"],
        task_id=row["task_id"] or "",
        attempt=row["attempt"] or 1,
        status=RunStatus(row["status"]),
        worker_id=row["worker_id"] or "",
        log_file=row["log_file"],
        pr_url=row["pr_url"],
        ci_status=row["ci_status"],
        ci_run_id=row["ci_run_id"],
        error=row["error"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        duration_seconds=row["duration_seconds"],
    )


async def _save_trd(db: Database, trd: TRD, idempotency_key: Optional[str] = None) -> None:
    """Save TRD to database."""
    await db.execute(
        """
        INSERT INTO trds (id, title, description, kr_id, status, projects, acceptance_criteria, idempotency_key, created_at, updated_at, planned_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            kr_id = EXCLUDED.kr_id,
            status = EXCLUDED.status,
            projects = EXCLUDED.projects,
            acceptance_criteria = EXCLUDED.acceptance_criteria,
            updated_at = EXCLUDED.updated_at,
            planned_at = EXCLUDED.planned_at,
            completed_at = EXCLUDED.completed_at
        """,
        trd.id, trd.title, trd.description, trd.kr_id, trd.status.value,
        json.dumps(trd.projects), json.dumps(trd.acceptance_criteria),
        idempotency_key, trd.created_at, trd.updated_at, trd.planned_at, trd.completed_at
    )


async def _save_task(db: Database, task: Task) -> None:
    """Save Task to database."""
    await db.execute(
        """
        INSERT INTO tasks (id, trd_id, title, description, repo, branch, status, priority, depends_on, acceptance, prd_content, pr_url, worker_id, retry_count, max_retries, blocked_reason, blocked_at, created_at, updated_at, started_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            repo = EXCLUDED.repo,
            branch = EXCLUDED.branch,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            depends_on = EXCLUDED.depends_on,
            acceptance = EXCLUDED.acceptance,
            prd_content = EXCLUDED.prd_content,
            pr_url = EXCLUDED.pr_url,
            worker_id = EXCLUDED.worker_id,
            retry_count = EXCLUDED.retry_count,
            blocked_reason = EXCLUDED.blocked_reason,
            blocked_at = EXCLUDED.blocked_at,
            updated_at = EXCLUDED.updated_at,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at
        """,
        task.id, task.trd_id, task.title, task.description, task.repo, task.branch,
        task.status.value, task.priority, json.dumps(task.depends_on), json.dumps(task.acceptance),
        task.prd_content, task.pr_url, task.worker_id, task.retry_count, task.max_retries,
        task.blocked_reason, task.blocked_at, task.created_at, task.updated_at,
        task.started_at, task.completed_at
    )


async def _save_run(db: Database, run: Run) -> None:
    """Save Run execution info to tasks table (task = run in unified model)."""
    await db.execute(
        """
        UPDATE tasks SET
            run_id = $1,
            attempt = $2,
            worker_id = $3,
            pr_url = COALESCE($4, pr_url),
            ci_status = COALESCE($5, ci_status),
            ci_run_id = COALESCE($6, ci_run_id),
            error = $7,
            duration = $8,
            updated_at = NOW()
        WHERE id = $9
        """,
        run.id, run.attempt, run.worker_id,
        run.pr_url, run.ci_status, run.ci_run_id, run.error,
        run.duration_seconds, run.task_id
    )


# ==================== TRD Endpoints ====================

@router.post("/trd", response_model=TRDResponse)
async def create_trd(request: CreateTRDRequest):
    """Create a new TRD. 护栏 1: 如果 idempotency_key 已存在，返回已有 TRD。"""
    db = get_db()

    # 护栏 1: 幂等检查
    if request.idempotency_key:
        existing = await db.fetchrow(
            "SELECT * FROM trds WHERE idempotency_key = $1",
            request.idempotency_key
        )
        if existing:
            return _trd_to_response(_row_to_trd(existing))

    trd = TRD(
        title=request.title,
        description=request.description,
        kr_id=request.kr_id,
        projects=request.projects,
        acceptance_criteria=request.acceptance_criteria,
    )
    await _save_trd(db, trd, idempotency_key=request.idempotency_key)
    return _trd_to_response(trd)


@router.get("/trd/{trd_id}", response_model=TRDResponse)
async def get_trd(trd_id: str):
    """Get a TRD by ID."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM trds WHERE id = $1", trd_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"TRD {trd_id} not found")
    return _trd_to_response(_row_to_trd(row))


@router.get("/trds", response_model=List[TRDResponse])
async def list_trds(status: Optional[str] = None):
    """List all TRDs, optionally filtered by status."""
    db = get_db()
    if status:
        rows = await db.fetch("SELECT * FROM trds WHERE status = $1 ORDER BY created_at DESC", status)
    else:
        rows = await db.fetch("SELECT * FROM trds ORDER BY created_at DESC")
    return [_trd_to_response(_row_to_trd(row)) for row in rows]


@router.post("/trd/{trd_id}/plan")
async def plan_trd(trd_id: str, request: PlanTRDRequest):
    """Plan a TRD - generate tasks using LLM."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM trds WHERE id = $1", trd_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"TRD {trd_id} not found")

    trd = _row_to_trd(row)
    if trd.status != TRDStatus.DRAFT:
        raise HTTPException(
            status_code=400,
            detail=f"TRD must be in draft status to plan, current: {trd.status.value}"
        )

    # Call planner
    result = _planner.plan(trd, request.context)
    if not result.success:
        raise HTTPException(status_code=500, detail=result.error)

    # Validate tasks
    errors = _planner.validate_tasks(result.tasks)
    if errors:
        raise HTTPException(status_code=400, detail=f"Invalid tasks: {errors}")

    # Update state
    try:
        trd, tasks = _state_machine.plan_trd(trd, result.tasks)
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Save to DB
    await _save_trd(db, trd)
    for task in tasks:
        await _save_task(db, task)

    return {
        "success": True,
        "trd": _trd_to_response(trd),
        "tasks": [_task_to_response(t) for t in tasks],
    }


# ==================== Task Endpoints ====================

@router.get("/tasks", response_model=List[TaskResponse])
async def list_tasks(
    trd_id: Optional[str] = None,
    status: Optional[str] = None,
):
    """List tasks, optionally filtered."""
    db = get_db()
    query = "SELECT * FROM tasks WHERE 1=1"
    params = []
    idx = 1
    if trd_id:
        query += f" AND trd_id = ${idx}"
        params.append(trd_id)
        idx += 1
    if status:
        query += f" AND status = ${idx}"
        params.append(status)
        idx += 1
    query += " ORDER BY created_at DESC"
    rows = await db.fetch(query, *params)
    return [_task_to_response(_row_to_task(row)) for row in rows]


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    """Get a task by ID."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM tasks WHERE id = $1", task_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return _task_to_response(_row_to_task(row))


@router.get("/next")
async def get_next_task():
    """Get the next task ready for execution."""
    db = get_db()
    rows = await db.fetch("SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority, created_at")
    tasks = [_row_to_task(row) for row in rows]
    task = _dispatcher.get_next_task(tasks)

    if not task:
        return {"success": False, "task": None, "message": "No ready tasks"}

    return {
        "success": True,
        "task": _task_to_response(task),
    }


@router.post("/tasks/{task_id}/start", response_model=RunResponse)
async def start_task(task_id: str, request: StartTaskRequest):
    """Start executing a task - creates a Run."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM tasks WHERE id = $1", task_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = _row_to_task(row)

    # Assign and start
    try:
        _state_machine.assign_task(task, request.worker_id)
        _state_machine.start_task(task)
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Create run
    run = Run(
        task_id=task_id,
        attempt=task.retry_count + 1,
        worker_id=request.worker_id,
        log_file=request.log_file,
    )

    # Save to DB
    await _save_task(db, task)
    await _save_run(db, run)

    # Update TRD status if needed
    if task.trd_id:
        trd_row = await db.fetchrow("SELECT * FROM trds WHERE id = $1", task.trd_id)
        if trd_row:
            trd = _row_to_trd(trd_row)
            if trd.status == TRDStatus.PLANNED:
                try:
                    _state_machine.transition_trd(trd, TRDStatus.IN_PROGRESS)
                    await _save_trd(db, trd)
                except StateTransitionError:
                    pass

    return _run_to_response(run)


# ==================== Run Endpoints (Unified: task = run) ====================

@router.get("/runs", response_model=List[RunResponse])
async def list_runs(task_id: Optional[str] = None):
    """List runs (tasks with execution info), optionally filtered by task.

    In unified model: task = run. This endpoint returns tasks that have run_id.
    """
    db = get_db()
    if task_id:
        rows = await db.fetch(
            "SELECT * FROM tasks WHERE id = $1 AND run_id IS NOT NULL ORDER BY started_at DESC",
            task_id
        )
    else:
        rows = await db.fetch(
            "SELECT * FROM tasks WHERE run_id IS NOT NULL ORDER BY started_at DESC"
        )
    return [_task_to_run_response(row) for row in rows]


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: str):
    """Get a run by ID (from tasks table in unified model)."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM tasks WHERE run_id = $1", run_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _task_to_run_response(row)


@router.post("/runs/{run_id}/complete", response_model=RunResponse)
async def complete_run(run_id: str, request: CompleteRunRequest):
    """Complete a run and update task status (unified model: task = run)."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM tasks WHERE run_id = $1", run_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    task = _row_to_task(row)

    # Map status string to enum
    status_map = {
        "success": RunStatus.SUCCESS,
        "failed": RunStatus.FAILED,
        "timeout": RunStatus.TIMEOUT,
        "cancelled": RunStatus.CANCELLED,
    }
    run_status = status_map.get(request.status.lower())
    if not run_status:
        raise HTTPException(status_code=400, detail=f"Invalid status: {request.status}")

    # Update task with run completion info
    try:
        if run_status == RunStatus.SUCCESS:
            _state_machine.complete_task(task, request.pr_url)
        elif run_status in [RunStatus.FAILED, RunStatus.TIMEOUT]:
            _state_machine.fail_task(task, request.error)
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Update execution fields
    task.pr_url = request.pr_url or task.pr_url
    await db.execute(
        """
        UPDATE tasks SET
            status = $1,
            pr_url = COALESCE($2, pr_url),
            ci_status = $3,
            ci_run_id = $4,
            error = $5,
            updated_at = NOW(),
            completed_at = CASE WHEN $1 IN ('done', 'failed') THEN NOW() ELSE completed_at END
        WHERE run_id = $6
        """,
        task.status.value, request.pr_url, request.ci_status,
        request.ci_run_id, request.error, run_id
    )

    # Release worker from dispatcher (in-memory)
    if task.worker_id:
        _dispatcher.release_worker(task.worker_id)

    # Return updated run response
    updated_row = await db.fetchrow("SELECT * FROM tasks WHERE run_id = $1", run_id)
    return _task_to_run_response(updated_row)


# ==================== Tick Endpoint (护栏 3: 文件锁) ====================

TICK_LOCK_FILE = os.path.join(tempfile.gettempdir(), "autumnrice_tick.lock")


def _try_acquire_tick_lock() -> Optional[int]:
    """Try to acquire tick lock."""
    try:
        fd = os.open(TICK_LOCK_FILE, os.O_CREAT | os.O_RDWR)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except (IOError, OSError):
        return None


def _release_tick_lock(fd: int) -> None:
    """Release tick lock."""
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
    except (IOError, OSError):
        pass


@router.post("/tick", response_model=TickResponse)
async def tick():
    """Advance the state machine. 护栏 3: 文件锁防止并发。

    In unified model: task = run. Runs are derived from tasks with run_id.
    """
    lock_fd = _try_acquire_tick_lock()
    if lock_fd is None:
        return TickResponse(skipped="locked - another tick is running")

    try:
        db = get_db()
        trd_rows = await db.fetch("SELECT * FROM trds")
        task_rows = await db.fetch("SELECT * FROM tasks")

        trds = [_row_to_trd(r) for r in trd_rows]
        tasks = [_row_to_task(r) for r in task_rows]

        # Derive runs from tasks with run_id (unified model: task = run)
        runs = []
        for row in task_rows:
            if row["run_id"]:
                runs.append(Run(
                    id=row["run_id"],
                    task_id=row["id"],
                    attempt=row["attempt"] or 1,
                    status=RunStatus(row["status"]) if row["status"] in ["running", "success", "failed", "timeout", "cancelled"] else RunStatus.RUNNING,
                    worker_id=row["worker_id"] or "",
                    pr_url=row["pr_url"],
                    ci_status=row["ci_status"],
                    ci_run_id=row["ci_run_id"],
                    error=row.get("blocked_reason"),
                    started_at=row["started_at"],
                    ended_at=row["completed_at"],
                    duration_seconds=row.get("duration"),
                ))

        result = _state_machine.tick(trds, tasks, runs)

        for trd in result["updated_trds"]:
            await _save_trd(db, trd)
        for task in result["updated_tasks"]:
            await _save_task(db, task)
        for task in result["retried_tasks"]:
            await _save_task(db, task)
        for task in result["unblocked_tasks"]:
            await _save_task(db, task)

        # 护栏 2: 进度摘要
        queued = len([t for t in tasks if t.status == TaskStatus.QUEUED])
        running = len([t for t in tasks if t.status == TaskStatus.RUNNING])
        done = len([t for t in tasks if t.status == TaskStatus.DONE])
        failed = len([t for t in tasks if t.status == TaskStatus.FAILED])
        blocked = len([t for t in tasks if t.status == TaskStatus.BLOCKED])
        summary = f"Tasks: {queued} queued, {running} running, {done} done, {failed} failed, {blocked} blocked"

        return TickResponse(
            updated_trds=[t.id for t in result["updated_trds"]],
            updated_tasks=[t.id for t in result["updated_tasks"]],
            retried_tasks=[t.id for t in result["retried_tasks"]],
            unblocked_tasks=[t.id for t in result["unblocked_tasks"]],
            progress_summary=summary,
        )
    finally:
        _release_tick_lock(lock_fd)


# ==================== Status Endpoints (护栏 2) ====================

@router.get("/status")
async def get_status():
    """Get current status. 护栏 2: 状态回流。"""
    db = get_db()
    active_rows = await db.fetch(
        "SELECT id, title, status FROM trds WHERE status IN ('in_progress', 'planned') ORDER BY updated_at DESC LIMIT 10"
    )
    active_trds = [{"id": r["id"], "title": r["title"], "status": r["status"]} for r in active_rows]
    queued = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE status = 'queued'") or 0
    running = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE status = 'running'") or 0
    blocked = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE status = 'blocked'") or 0
    error_rows = await db.fetch(
        "SELECT id, blocked_reason FROM tasks WHERE status IN ('failed', 'blocked') AND blocked_reason IS NOT NULL ORDER BY updated_at DESC LIMIT 5"
    )
    recent_errors = [f"{r['id']}: {r['blocked_reason']}" for r in error_rows]
    return {
        "active_trds": active_trds,
        "queued_tasks": queued,
        "running_tasks": running,
        "blocked_tasks": blocked,
        "recent_errors": recent_errors,
        "summary": f"{len(active_trds)} active TRDs, {queued} queued, {running} running, {blocked} blocked",
    }


@router.get("/latest")
async def get_latest():
    """Get recent activity. 护栏 2: 昨晚跑了什么。"""
    db = get_db()
    yesterday = datetime.now() - timedelta(hours=24)
    completed_rows = await db.fetch(
        "SELECT id, title, completed_at FROM trds WHERE status = 'done' AND completed_at > $1 ORDER BY completed_at DESC",
        yesterday
    )
    completed_trds = [{"id": r["id"], "title": r["title"], "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None} for r in completed_rows]
    completed_tasks = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE status = 'done' AND completed_at > $1", yesterday) or 0
    failed_tasks = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND updated_at > $1", yesterday) or 0
    pr_rows = await db.fetch("SELECT pr_url FROM tasks WHERE pr_url IS NOT NULL AND updated_at > $1", yesterday)
    prs = [r["pr_url"] for r in pr_rows if r["pr_url"]]
    return {
        "completed_trds_24h": completed_trds,
        "completed_tasks_24h": completed_tasks,
        "failed_tasks_24h": failed_tasks,
        "prs_created_24h": prs,
        "summary": f"Last 24h: {len(completed_trds)} TRDs done, {completed_tasks} tasks completed, {failed_tasks} failed, {len(prs)} PRs",
    }


# ==================== Worker Endpoints (Unified: workers = seats) ====================
#
# In unified model, "workers" are replaced by dynamic "seats" managed by the executor.
# These endpoints provide backwards-compatible views of seats as workers.

@router.post("/workers", response_model=WorkerResponse)
async def register_worker(request: RegisterWorkerRequest):
    """Register a new worker (deprecated - use seats).

    In unified model, workers are dynamic seats. This endpoint registers
    a worker in the in-memory dispatcher for backwards compatibility.
    """
    worker_id = f"W-{datetime.now().strftime('%Y%m%d%H%M%S')}"

    # Register in dispatcher (in-memory only, no DB)
    worker = _dispatcher.register_worker(worker_id, request.name, request.capabilities)
    return _worker_to_response(worker)


@router.get("/workers", response_model=List[WorkerResponse])
async def list_workers():
    """List all workers (shows active seats as workers).

    In unified model, workers = seats. Returns seats as WorkerResponse format.
    """
    executor = get_executor()
    seats = executor.get_seats()

    workers = []
    for seat in seats.get("seats", []):
        workers.append(WorkerResponse(
            id=f"seat-{seat['seat_id']}",
            name=f"Seat {seat['seat_id']}",
            status=seat["status"],
            current_task_id=seat.get("task_id"),
            last_heartbeat=seat.get("started_at") or datetime.now().isoformat(),
            capabilities=["claude", "headless"],
        ))
    return workers


@router.post("/workers/{worker_id}/heartbeat", response_model=WorkerResponse)
async def worker_heartbeat(worker_id: str):
    """Update worker heartbeat (no-op in seats model).

    In unified model, seats are managed dynamically by the executor.
    Heartbeat is not needed - seat status is real-time.
    """
    executor = get_executor()
    seats = executor.get_seats()

    # Find seat by ID
    seat_id = int(worker_id.replace("seat-", "").replace("W-", "")) if worker_id.startswith(("seat-", "W-")) else 1
    seat = next((s for s in seats.get("seats", []) if s["seat_id"] == seat_id), None)

    if not seat:
        # Return a default response for backwards compatibility
        return WorkerResponse(
            id=worker_id,
            name=f"Worker {worker_id}",
            status="idle",
            current_task_id=None,
            last_heartbeat=datetime.now().isoformat(),
            capabilities=["claude", "headless"],
        )

    return WorkerResponse(
        id=f"seat-{seat['seat_id']}",
        name=f"Seat {seat['seat_id']}",
        status=seat["status"],
        current_task_id=seat.get("task_id"),
        last_heartbeat=seat.get("started_at") or datetime.now().isoformat(),
        capabilities=["claude", "headless"],
    )


# ==================== Summary Endpoint ====================

@router.get("/summary")
async def get_summary():
    """Get overall orchestrator summary.

    In unified model: workers = seats, runs = tasks with run_id.
    """
    db = get_db()
    executor = get_executor()

    # Count TRDs by status
    trd_counts = await db.fetch("SELECT status, COUNT(*) as count FROM trds GROUP BY status")
    trds_by_status = {r["status"]: r["count"] for r in trd_counts}
    total_trds = sum(trds_by_status.values())

    # Count tasks by status
    task_counts = await db.fetch("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
    tasks_by_status = {r["status"]: r["count"] for r in task_counts}
    total_tasks = sum(tasks_by_status.values())

    # Count ready tasks
    ready_count = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE status = 'queued'")

    # Get seats info (replaces workers)
    seats = executor.get_seats()
    total_seats = seats.get("max_seats", 0)
    available_seats = seats.get("available_seats", 0)

    # Count runs (tasks with run_id in unified model)
    total_runs = await db.fetchval("SELECT COUNT(*) FROM tasks WHERE run_id IS NOT NULL")

    return {
        "trds": {
            "total": total_trds,
            "by_status": trds_by_status,
        },
        "tasks": {
            "total_tasks": total_tasks,
            "ready_tasks": ready_count or 0,
            "available_seats": available_seats,
            "total_seats": total_seats,
            "tasks_by_status": tasks_by_status,
            "can_dispatch": (ready_count or 0) > 0 and seats.get("can_spawn_more", False),
        },
        "runs": {
            "total": total_runs or 0,
        },
        "seats": seats,
    }


# ==================== Resource & Execution Endpoints ====================


class ExecuteRequest(BaseModel):
    """Request to execute tasks."""
    max_concurrent: Optional[int] = None  # None = auto based on resources
    task_ids: Optional[List[str]] = None  # None = execute all ready tasks


@router.get("/resources")
async def get_resources():
    """Get system resource status for worker pool management."""
    executor = get_executor()
    resources = executor.get_resources()
    return resources.to_dict()


@router.get("/seats")
async def get_seats():
    """Get seats (execution slots) status.

    Returns dynamic seat information:
    - max_seats: Maximum concurrent seats based on resources
    - active_seats: Currently occupied seats
    - available_seats: Free seats for new tasks
    - can_spawn_more: Whether new tasks can be started
    - throttle_reason: Why spawning is blocked (if applicable)
    - seats: List of individual seat statuses

    Seat calculation considers:
    - Available memory (1.5GB per seat, 2GB system reserve)
    - CPU count (1 seat per 1.5 CPUs)
    - Load average (throttle if > 6.0)
    - Hard limit of 6 concurrent seats
    """
    executor = get_executor()
    return executor.get_seats()


@router.post("/execute")
async def execute_tasks(request: ExecuteRequest = None):
    """Execute queued tasks. Use this for manual execution or N8N trigger.

    This endpoint:
    1. Checks system resources
    2. Selects ready tasks (up to max_concurrent)
    3. Executes them via Claude
    4. Updates task/run status in DB
    """
    db = get_db()
    executor = get_executor()

    # Check resources
    resources = executor.get_resources()
    if not resources.can_spawn_more:
        return {
            "success": False,
            "error": "Insufficient resources",
            "resources": resources.to_dict(),
        }

    # Get ready tasks
    if request and request.task_ids:
        # Execute specific tasks
        task_rows = await db.fetch(
            "SELECT * FROM tasks WHERE id = ANY($1) AND status = 'queued'",
            request.task_ids
        )
    else:
        # Execute all ready tasks
        task_rows = await db.fetch(
            "SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority, created_at"
        )

    if not task_rows:
        return {
            "success": True,
            "message": "No ready tasks to execute",
            "executed": 0,
        }

    tasks = [_row_to_task(row) for row in task_rows]

    # Limit by resources
    max_concurrent = request.max_concurrent if request else None
    if max_concurrent is None:
        max_concurrent = resources.max_workers
    max_concurrent = min(max_concurrent, len(tasks))

    tasks_to_execute = tasks[:max_concurrent]

    # Update tasks to running status
    for task in tasks_to_execute:
        task.status = TaskStatus.RUNNING
        task.started_at = datetime.now()
        await _save_task(db, task)

    # Execute tasks (this runs them in parallel with semaphore)
    results = await executor.execute_batch(tasks_to_execute, max_concurrent)

    # Process results
    executed = []
    for result in results:
        task = next((t for t in tasks_to_execute if t.id == result.task_id), None)
        if not task:
            continue

        # Update task status
        if result.success:
            task.status = TaskStatus.DONE
            task.completed_at = datetime.now()
            task.pr_url = result.pr_url
        else:
            task.retry_count += 1
            if task.retry_count >= task.max_retries:
                task.status = TaskStatus.FAILED
                task.blocked_reason = result.error
            else:
                task.status = TaskStatus.QUEUED  # Will retry on next tick

        task.updated_at = datetime.now()
        await _save_task(db, task)

        # Create run record
        run = Run(
            id=result.run_id,
            task_id=task.id,
            attempt=task.retry_count,
            status=RunStatus.SUCCESS if result.success else RunStatus.FAILED,
            worker_id="executor",
            pr_url=result.pr_url,
            error=result.error if not result.success else None,
            started_at=task.started_at,
            ended_at=datetime.now(),
            duration_seconds=result.duration_seconds,
        )
        await _save_run(db, run)

        executed.append({
            "task_id": task.id,
            "run_id": result.run_id,
            "success": result.success,
            "status": result.status,
            "pr_url": result.pr_url,
            "error": result.error if not result.success else None,
        })

    return {
        "success": True,
        "executed": len(executed),
        "results": executed,
        "resources": resources.to_dict(),
    }


# ==================== Response Helper Functions ====================

def _trd_to_response(trd: TRD) -> TRDResponse:
    """Convert TRD to response model."""
    return TRDResponse(
        id=trd.id,
        title=trd.title,
        description=trd.description,
        kr_id=trd.kr_id,
        status=trd.status.value,
        projects=trd.projects,
        acceptance_criteria=trd.acceptance_criteria,
        created_at=trd.created_at.isoformat() if trd.created_at else "",
        updated_at=trd.updated_at.isoformat() if trd.updated_at else "",
        planned_at=trd.planned_at.isoformat() if trd.planned_at else None,
        completed_at=trd.completed_at.isoformat() if trd.completed_at else None,
    )


def _task_to_response(task: Task) -> TaskResponse:
    """Convert Task to response model."""
    return TaskResponse(
        id=task.id,
        trd_id=task.trd_id,
        title=task.title,
        description=task.description,
        repo=task.repo,
        branch=task.branch,
        status=task.status.value,
        priority=task.priority,
        depends_on=task.depends_on,
        acceptance=task.acceptance,
        pr_url=task.pr_url,
        worker_id=task.worker_id,
        retry_count=task.retry_count,
        blocked_reason=task.blocked_reason,
        created_at=task.created_at.isoformat() if task.created_at else "",
        started_at=task.started_at.isoformat() if task.started_at else None,
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
    )


def _run_to_response(run: Run) -> RunResponse:
    """Convert Run to response model."""
    return RunResponse(
        id=run.id,
        task_id=run.task_id,
        attempt=run.attempt,
        status=run.status.value,
        worker_id=run.worker_id,
        log_file=run.log_file,
        pr_url=run.pr_url,
        ci_status=run.ci_status,
        ci_run_id=run.ci_run_id,
        error=run.error,
        started_at=run.started_at.isoformat() if run.started_at else "",
        ended_at=run.ended_at.isoformat() if run.ended_at else None,
        duration_seconds=run.duration_seconds,
    )


def _task_to_run_response(row) -> RunResponse:
    """Convert task row to RunResponse (unified model: task = run)."""
    return RunResponse(
        id=row["run_id"] or row["id"],
        task_id=row["id"],
        attempt=row["attempt"] or 1,
        status=row["status"],
        worker_id=row["worker_id"] or "",
        log_file=None,  # No separate log file in unified model
        pr_url=row["pr_url"],
        ci_status=row["ci_status"],
        ci_run_id=row["ci_run_id"],
        error=row.get("error") or row.get("blocked_reason"),
        started_at=row["started_at"].isoformat() if row["started_at"] else "",
        ended_at=row["completed_at"].isoformat() if row["completed_at"] else None,
        duration_seconds=row.get("duration"),
    )


def _worker_to_response(worker: Worker) -> WorkerResponse:
    """Convert Worker to response model."""
    return WorkerResponse(
        id=worker.id,
        name=worker.name,
        status=worker.status,
        current_task_id=worker.current_task_id,
        last_heartbeat=worker.last_heartbeat.isoformat(),
        capabilities=worker.capabilities,
    )
