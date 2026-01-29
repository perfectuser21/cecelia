"""API routes for Orchestrator state machine."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.orchestrator.models import (
    TRD,
    TRDStatus,
    Task,
    Run,
    RunStatus,
)
from src.orchestrator.state_machine import StateMachine, StateTransitionError
from src.orchestrator.planner import Planner
from src.orchestrator.dispatcher import Dispatcher, Worker

router = APIRouter(prefix="/orchestrator/v2", tags=["orchestrator-v2"])

# In-memory storage (will be replaced with DB later)
_trds: Dict[str, TRD] = {}
_tasks: Dict[str, Task] = {}
_runs: Dict[str, Run] = {}

# Shared instances
_state_machine = StateMachine()
_planner = Planner()
_dispatcher = Dispatcher(state_machine=_state_machine)


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


# ==================== TRD Endpoints ====================

@router.post("/trd", response_model=TRDResponse)
async def create_trd(request: CreateTRDRequest):
    """Create a new TRD."""
    trd = TRD(
        title=request.title,
        description=request.description,
        kr_id=request.kr_id,
        projects=request.projects,
        acceptance_criteria=request.acceptance_criteria,
    )
    _trds[trd.id] = trd
    return _trd_to_response(trd)


@router.get("/trd/{trd_id}", response_model=TRDResponse)
async def get_trd(trd_id: str):
    """Get a TRD by ID."""
    if trd_id not in _trds:
        raise HTTPException(status_code=404, detail=f"TRD {trd_id} not found")
    return _trd_to_response(_trds[trd_id])


@router.get("/trds", response_model=List[TRDResponse])
async def list_trds(status: Optional[str] = None):
    """List all TRDs, optionally filtered by status."""
    trds = list(_trds.values())
    if status:
        trds = [t for t in trds if t.status.value == status]
    return [_trd_to_response(t) for t in trds]


@router.post("/trd/{trd_id}/plan")
async def plan_trd(trd_id: str, request: PlanTRDRequest):
    """Plan a TRD - generate tasks using LLM."""
    if trd_id not in _trds:
        raise HTTPException(status_code=404, detail=f"TRD {trd_id} not found")

    trd = _trds[trd_id]
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

    # Store tasks
    for task in tasks:
        _tasks[task.id] = task

    _trds[trd_id] = trd

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
    tasks = list(_tasks.values())
    if trd_id:
        tasks = [t for t in tasks if t.trd_id == trd_id]
    if status:
        tasks = [t for t in tasks if t.status.value == status]
    return [_task_to_response(t) for t in tasks]


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    """Get a task by ID."""
    if task_id not in _tasks:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return _task_to_response(_tasks[task_id])


@router.get("/next")
async def get_next_task():
    """Get the next task ready for execution."""
    tasks = list(_tasks.values())
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
    if task_id not in _tasks:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    task = _tasks[task_id]

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
    _runs[run.id] = run

    # Update TRD status if needed
    if task.trd_id in _trds:
        trd = _trds[task.trd_id]
        if trd.status == TRDStatus.PLANNED:
            try:
                _state_machine.transition_trd(trd, TRDStatus.IN_PROGRESS)
            except StateTransitionError:
                pass

    return _run_to_response(run)


# ==================== Run Endpoints ====================

@router.get("/runs", response_model=List[RunResponse])
async def list_runs(task_id: Optional[str] = None):
    """List runs, optionally filtered by task."""
    runs = list(_runs.values())
    if task_id:
        runs = [r for r in runs if r.task_id == task_id]
    return [_run_to_response(r) for r in runs]


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(run_id: str):
    """Get a run by ID."""
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _run_to_response(_runs[run_id])


@router.post("/runs/{run_id}/complete", response_model=RunResponse)
async def complete_run(run_id: str, request: CompleteRunRequest):
    """Complete a run and update task status."""
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    task = _tasks.get(run.task_id)

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

    # Update task
    if task:
        try:
            if run_status == RunStatus.SUCCESS:
                _state_machine.complete_task(task, request.pr_url)
            elif run_status in [RunStatus.FAILED, RunStatus.TIMEOUT]:
                _state_machine.fail_task(task, request.error)
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
    trds = list(_trds.values())
    tasks = list(_tasks.values())
    runs = list(_runs.values())

    result = _state_machine.tick(trds, tasks, runs)

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
    worker_id = f"W-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    worker = _dispatcher.register_worker(worker_id, request.name, request.capabilities)
    return _worker_to_response(worker)


@router.get("/workers", response_model=List[WorkerResponse])
async def list_workers():
    """List all workers."""
    return [_worker_to_response(w) for w in _dispatcher.workers.values()]


@router.post("/workers/{worker_id}/heartbeat", response_model=WorkerResponse)
async def worker_heartbeat(worker_id: str):
    """Update worker heartbeat."""
    worker = _dispatcher.update_worker_heartbeat(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail=f"Worker {worker_id} not found")
    return _worker_to_response(worker)


# ==================== Summary Endpoint ====================

@router.get("/summary")
async def get_summary():
    """Get overall orchestrator summary."""
    tasks = list(_tasks.values())
    dispatch_summary = _dispatcher.get_dispatch_summary(tasks)

    trds_by_status = {}
    for trd in _trds.values():
        status = trd.status.value
        trds_by_status[status] = trds_by_status.get(status, 0) + 1

    return {
        "trds": {
            "total": len(_trds),
            "by_status": trds_by_status,
        },
        "tasks": dispatch_summary,
        "runs": {
            "total": len(_runs),
        },
    }


# ==================== Helper Functions ====================

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
        created_at=trd.created_at.isoformat(),
        updated_at=trd.updated_at.isoformat(),
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
        created_at=task.created_at.isoformat(),
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
        started_at=run.started_at.isoformat(),
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
