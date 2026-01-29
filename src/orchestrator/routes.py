"""API routes for Orchestrator state machine with PostgreSQL persistence."""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.orchestrator.models import (
    TRD,
    TRDStatus,
    Task,
    TaskStatus,
    Run,
    RunStatus,
)
from src.orchestrator.state_machine import StateMachine, StateTransitionError
from src.orchestrator.planner import Planner
from src.orchestrator.dispatcher import Dispatcher, Worker
from src.db.pool import Database

router = APIRouter(prefix="/orchestrator/v2", tags=["orchestrator-v2"])

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
    """Create orchestrator tables if they don't exist."""
    # TRDs table
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS trds (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            kr_id TEXT,
            status TEXT DEFAULT 'draft',
            projects JSONB DEFAULT '[]',
            acceptance_criteria JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            planned_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_trds_status ON trds(status)"
    )

    # Tasks table
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS orchestrator_tasks (
            id TEXT PRIMARY KEY,
            trd_id TEXT REFERENCES trds(id),
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            repo TEXT DEFAULT '',
            branch TEXT DEFAULT '',
            status TEXT DEFAULT 'queued',
            priority TEXT DEFAULT 'P1',
            depends_on JSONB DEFAULT '[]',
            acceptance JSONB DEFAULT '[]',
            prd_content TEXT DEFAULT '',
            pr_url TEXT,
            worker_id TEXT,
            retry_count INT DEFAULT 0,
            max_retries INT DEFAULT 3,
            blocked_reason TEXT,
            blocked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_trd ON orchestrator_tasks(trd_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_status ON orchestrator_tasks(status)"
    )

    # Runs table
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS orchestrator_runs (
            id TEXT PRIMARY KEY,
            task_id TEXT REFERENCES orchestrator_tasks(id),
            attempt INT DEFAULT 1,
            status TEXT DEFAULT 'running',
            worker_id TEXT DEFAULT '',
            log_file TEXT,
            pr_url TEXT,
            ci_status TEXT,
            ci_run_id TEXT,
            error TEXT,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            duration_seconds INT
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_task ON orchestrator_runs(task_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_status ON orchestrator_runs(status)"
    )

    # Workers table
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS orchestrator_workers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT DEFAULT 'idle',
            current_task_id TEXT,
            capabilities JSONB DEFAULT '[]',
            last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )


# ==================== Request/Response Models ====================

class CreateTRDRequest(BaseModel):
    """Request to create a TRD."""
    title: str
    description: str = ""
    kr_id: Optional[str] = None
    projects: List[str] = []
    acceptance_criteria: List[str] = []


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
    updated_trds: List[str]
    updated_tasks: List[str]
    retried_tasks: List[str]
    unblocked_tasks: List[str]


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


async def _save_trd(db: Database, trd: TRD) -> None:
    """Save TRD to database."""
    await db.execute(
        """
        INSERT INTO trds (id, title, description, kr_id, status, projects, acceptance_criteria, created_at, updated_at, planned_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        trd.created_at, trd.updated_at, trd.planned_at, trd.completed_at
    )


async def _save_task(db: Database, task: Task) -> None:
    """Save Task to database."""
    await db.execute(
        """
        INSERT INTO orchestrator_tasks (id, trd_id, title, description, repo, branch, status, priority, depends_on, acceptance, prd_content, pr_url, worker_id, retry_count, max_retries, blocked_reason, blocked_at, created_at, updated_at, started_at, completed_at)
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
    """Save Run to database."""
    await db.execute(
        """
        INSERT INTO orchestrator_runs (id, task_id, attempt, status, worker_id, log_file, pr_url, ci_status, ci_run_id, error, started_at, ended_at, duration_seconds)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            pr_url = EXCLUDED.pr_url,
            ci_status = EXCLUDED.ci_status,
            ci_run_id = EXCLUDED.ci_run_id,
            error = EXCLUDED.error,
            ended_at = EXCLUDED.ended_at,
            duration_seconds = EXCLUDED.duration_seconds
        """,
        run.id, run.task_id, run.attempt, run.status.value, run.worker_id,
        run.log_file, run.pr_url, run.ci_status, run.ci_run_id, run.error,
        run.started_at, run.ended_at, run.duration_seconds
    )


# ==================== TRD Endpoints ====================

@router.post("/trd", response_model=TRDResponse)
async def create_trd(request: CreateTRDRequest):
    """Create a new TRD."""
    db = get_db()
    trd = TRD(
        title=request.title,
        description=request.description,
        kr_id=request.kr_id,
        projects=request.projects,
        acceptance_criteria=request.acceptance_criteria,
    )
    await _save_trd(db, trd)
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
    query = "SELECT * FROM orchestrator_tasks WHERE 1=1"
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
    row = await db.fetchrow("SELECT * FROM orchestrator_tasks WHERE id = $1", task_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return _task_to_response(_row_to_task(row))


@router.get("/next")
async def get_next_task():
    """Get the next task ready for execution."""
    db = get_db()
    rows = await db.fetch("SELECT * FROM orchestrator_tasks WHERE status = 'queued' ORDER BY priority, created_at")
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
    row = await db.fetchrow("SELECT * FROM orchestrator_tasks WHERE id = $1", task_id)
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


# ==================== Run Endpoints ====================

@router.get("/runs", response_model=List[RunResponse])
async def list_runs(task_id: Optional[str] = None):
    """List runs, optionally filtered by task."""
    db = get_db()
    if task_id:
        rows = await db.fetch("SELECT * FROM orchestrator_runs WHERE task_id = $1 ORDER BY started_at DESC", task_id)
    else:
        rows = await db.fetch("SELECT * FROM orchestrator_runs ORDER BY started_at DESC")
    return [_run_to_response(_row_to_run(row)) for row in rows]


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: str):
    """Get a run by ID."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM orchestrator_runs WHERE id = $1", run_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _run_to_response(_row_to_run(row))


@router.post("/runs/{run_id}/complete", response_model=RunResponse)
async def complete_run(run_id: str, request: CompleteRunRequest):
    """Complete a run and update task status."""
    db = get_db()
    row = await db.fetchrow("SELECT * FROM orchestrator_runs WHERE id = $1", run_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _row_to_run(row)
    task_row = await db.fetchrow("SELECT * FROM orchestrator_tasks WHERE id = $1", run.task_id)
    task = _row_to_task(task_row) if task_row else None

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

    # Update run
    try:
        _state_machine.transition_run(run, run_status, request.error)
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    run.pr_url = request.pr_url
    run.ci_status = request.ci_status
    run.ci_run_id = request.ci_run_id

    await _save_run(db, run)

    # Update task
    if task:
        try:
            if run_status == RunStatus.SUCCESS:
                _state_machine.complete_task(task, request.pr_url)
            elif run_status in [RunStatus.FAILED, RunStatus.TIMEOUT]:
                _state_machine.fail_task(task, request.error)
            await _save_task(db, task)
        except StateTransitionError:
            pass  # Task may already be in final state

        # Release worker
        if task.worker_id:
            _dispatcher.release_worker(task.worker_id)

    return _run_to_response(run)


# ==================== Tick Endpoint ====================

@router.post("/tick", response_model=TickResponse)
async def tick():
    """Advance the state machine - process retries, dependencies, etc."""
    db = get_db()

    # Load all from DB
    trd_rows = await db.fetch("SELECT * FROM trds")
    task_rows = await db.fetch("SELECT * FROM orchestrator_tasks")
    run_rows = await db.fetch("SELECT * FROM orchestrator_runs")

    trds = [_row_to_trd(r) for r in trd_rows]
    tasks = [_row_to_task(r) for r in task_rows]
    runs = [_row_to_run(r) for r in run_rows]

    result = _state_machine.tick(trds, tasks, runs)

    # Save updated objects
    for trd in result["updated_trds"]:
        await _save_trd(db, trd)
    for task in result["updated_tasks"]:
        await _save_task(db, task)
    for task in result["retried_tasks"]:
        await _save_task(db, task)
    for task in result["unblocked_tasks"]:
        await _save_task(db, task)

    return TickResponse(
        updated_trds=[t.id for t in result["updated_trds"]],
        updated_tasks=[t.id for t in result["updated_tasks"]],
        retried_tasks=[t.id for t in result["retried_tasks"]],
        unblocked_tasks=[t.id for t in result["unblocked_tasks"]],
    )


# ==================== Worker Endpoints ====================

@router.post("/workers", response_model=WorkerResponse)
async def register_worker(request: RegisterWorkerRequest):
    """Register a new worker."""
    db = get_db()
    worker_id = f"W-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    now = datetime.now()

    await db.execute(
        """
        INSERT INTO orchestrator_workers (id, name, capabilities, last_heartbeat)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            capabilities = EXCLUDED.capabilities,
            last_heartbeat = EXCLUDED.last_heartbeat
        """,
        worker_id, request.name, json.dumps(request.capabilities), now
    )

    # Also register in dispatcher (for in-memory dispatch logic)
    worker = _dispatcher.register_worker(worker_id, request.name, request.capabilities)
    return _worker_to_response(worker)


@router.get("/workers", response_model=List[WorkerResponse])
async def list_workers():
    """List all workers."""
    db = get_db()
    rows = await db.fetch("SELECT * FROM orchestrator_workers ORDER BY last_heartbeat DESC")
    workers = []
    for row in rows:
        capabilities = row["capabilities"] if isinstance(row["capabilities"], list) else json.loads(row["capabilities"] or "[]")
        workers.append(WorkerResponse(
            id=row["id"],
            name=row["name"],
            status=row["status"],
            current_task_id=row["current_task_id"],
            last_heartbeat=row["last_heartbeat"].isoformat() if row["last_heartbeat"] else datetime.now().isoformat(),
            capabilities=capabilities,
        ))
    return workers


@router.post("/workers/{worker_id}/heartbeat", response_model=WorkerResponse)
async def worker_heartbeat(worker_id: str):
    """Update worker heartbeat."""
    db = get_db()
    now = datetime.now()
    await db.execute(
        "UPDATE orchestrator_workers SET last_heartbeat = $1 WHERE id = $2",
        now, worker_id
    )
    row = await db.fetchrow("SELECT * FROM orchestrator_workers WHERE id = $1", worker_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Worker {worker_id} not found")

    capabilities = row["capabilities"] if isinstance(row["capabilities"], list) else json.loads(row["capabilities"] or "[]")
    return WorkerResponse(
        id=row["id"],
        name=row["name"],
        status=row["status"],
        current_task_id=row["current_task_id"],
        last_heartbeat=now.isoformat(),
        capabilities=capabilities,
    )


# ==================== Summary Endpoint ====================

@router.get("/summary")
async def get_summary():
    """Get overall orchestrator summary."""
    db = get_db()

    # Count TRDs by status
    trd_counts = await db.fetch("SELECT status, COUNT(*) as count FROM trds GROUP BY status")
    trds_by_status = {r["status"]: r["count"] for r in trd_counts}
    total_trds = sum(trds_by_status.values())

    # Count tasks by status
    task_counts = await db.fetch("SELECT status, COUNT(*) as count FROM orchestrator_tasks GROUP BY status")
    tasks_by_status = {r["status"]: r["count"] for r in task_counts}
    total_tasks = sum(tasks_by_status.values())

    # Count ready tasks
    ready_count = await db.fetchval("SELECT COUNT(*) FROM orchestrator_tasks WHERE status = 'queued'")

    # Count workers
    total_workers = await db.fetchval("SELECT COUNT(*) FROM orchestrator_workers")
    idle_workers = await db.fetchval("SELECT COUNT(*) FROM orchestrator_workers WHERE status = 'idle'")

    # Count runs
    total_runs = await db.fetchval("SELECT COUNT(*) FROM orchestrator_runs")

    return {
        "trds": {
            "total": total_trds,
            "by_status": trds_by_status,
        },
        "tasks": {
            "total_tasks": total_tasks,
            "ready_tasks": ready_count or 0,
            "idle_workers": idle_workers or 0,
            "total_workers": total_workers or 0,
            "tasks_by_status": tasks_by_status,
            "can_dispatch": (ready_count or 0) > 0 and (idle_workers or 0) > 0,
        },
        "runs": {
            "total": total_runs or 0,
        },
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
