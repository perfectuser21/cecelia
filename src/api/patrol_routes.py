"""Patrol API routes for monitoring and recovering stale tasks.

Provides endpoints for the Patrol Agent to detect and handle stuck Cecelia tasks.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.db.pool import Database
from src.state.patrol import (
    get_stale_tasks,
    get_task_by_id,
    record_diagnosis,
    record_action,
    get_patrol_logs,
    get_patrol_summary,
    DIAGNOSIS_STUCK_AFTER_SKILL,
    DIAGNOSIS_CI_TIMEOUT,
    DIAGNOSIS_PROCESS_DEAD,
    DIAGNOSIS_NORMAL,
    DIAGNOSIS_NEEDS_HUMAN,
    ACTION_RESTART,
    ACTION_CONTINUE,
    ACTION_MARK_HUMAN,
    ACTION_NONE,
    RESULT_SUCCESS,
    RESULT_FAILED,
    RESULT_SKIPPED,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/patrol", tags=["patrol"])


# Database dependency - will be set by main.py
_db: Optional[Database] = None


def set_database(db: Database) -> None:
    """Set the database instance for routes."""
    global _db
    _db = db


def get_db() -> Database:
    """Get the database instance."""
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not initialized")
    return _db


# Request/Response models
class StaleTaskResponse(BaseModel):
    """Stale task response."""

    id: str
    project: Optional[str] = None
    branch: Optional[str] = None
    prd_path: Optional[str] = None
    status: Optional[str] = None
    current_step: Optional[int] = None
    pid: Optional[int] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    error: Optional[str] = None
    pr_url: Optional[str] = None


class StaleTasksResponse(BaseModel):
    """Response for stale tasks list."""

    tasks: List[StaleTaskResponse]
    total: int
    threshold_minutes: int


class DiagnoseRequest(BaseModel):
    """Request to record diagnosis."""

    diagnosis: str
    details: Optional[Dict[str, Any]] = None


class DiagnoseResponse(BaseModel):
    """Response after recording diagnosis."""

    id: str
    task_id: str
    diagnosis: str
    details: Optional[Dict[str, Any]] = None
    created_at: str


class ActionRequest(BaseModel):
    """Request to record action."""

    action: str
    action_result: str
    details: Optional[Dict[str, Any]] = None


class ActionResponse(BaseModel):
    """Response after recording action."""

    id: str
    task_id: str
    action: str
    action_result: str
    details: Optional[Dict[str, Any]] = None
    created_at: str


class PatrolLogResponse(BaseModel):
    """Patrol log entry response."""

    id: str
    task_id: Optional[str] = None
    diagnosis: str
    action: Optional[str] = None
    action_result: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    created_at: str


class PatrolLogsResponse(BaseModel):
    """Response for patrol logs list."""

    logs: List[PatrolLogResponse]
    total: int


class PatrolSummaryResponse(BaseModel):
    """Patrol summary statistics."""

    stale_task_count: int
    diagnoses_24h: Dict[str, int]
    actions_24h: Dict[str, int]
    last_patrol: str


# Validation helpers
VALID_DIAGNOSES = {
    DIAGNOSIS_STUCK_AFTER_SKILL,
    DIAGNOSIS_CI_TIMEOUT,
    DIAGNOSIS_PROCESS_DEAD,
    DIAGNOSIS_NORMAL,
    DIAGNOSIS_NEEDS_HUMAN,
}

VALID_ACTIONS = {
    ACTION_RESTART,
    ACTION_CONTINUE,
    ACTION_MARK_HUMAN,
    ACTION_NONE,
}

VALID_RESULTS = {
    RESULT_SUCCESS,
    RESULT_FAILED,
    RESULT_SKIPPED,
}


@router.get("/stale", response_model=StaleTasksResponse)
async def get_stale_endpoint(
    threshold_minutes: int = 30,
    limit: int = 20,
):
    """Get list of stale (stuck) tasks.

    A task is considered stale if it has status 'running' or 'in_progress'
    but hasn't been updated in threshold_minutes.

    Args:
        threshold_minutes: Minutes of inactivity before considered stale (default: 30)
        limit: Maximum tasks to return (default: 20)
    """
    db = get_db()

    try:
        tasks = await get_stale_tasks(db, threshold_minutes=threshold_minutes, limit=limit)
    except Exception as e:
        logger.error(f"Error getting stale tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return StaleTasksResponse(
        tasks=[
            StaleTaskResponse(
                id=str(t["id"]),
                project=t.get("project"),
                branch=t.get("branch"),
                prd_path=t.get("prd_path"),
                status=t.get("status"),
                current_step=t.get("current_step"),
                pid=t.get("pid"),
                started_at=str(t["started_at"]) if t.get("started_at") else None,
                updated_at=str(t["updated_at"]) if t.get("updated_at") else None,
                error=t.get("error"),
                pr_url=t.get("pr_url"),
            )
            for t in tasks
        ],
        total=len(tasks),
        threshold_minutes=threshold_minutes,
    )


@router.post("/diagnose/{task_id}", response_model=DiagnoseResponse)
async def diagnose_endpoint(task_id: str, request: DiagnoseRequest):
    """Record a diagnosis for a task.

    Args:
        task_id: Task UUID
        request: Diagnosis details including diagnosis type
    """
    db = get_db()

    # Validate diagnosis type
    if request.diagnosis not in VALID_DIAGNOSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid diagnosis. Must be one of: {', '.join(VALID_DIAGNOSES)}",
        )

    # Verify task exists
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        result = await record_diagnosis(
            db,
            task_id=task_id,
            diagnosis=request.diagnosis,
            details=request.details,
        )
    except Exception as e:
        logger.error(f"Error recording diagnosis: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return DiagnoseResponse(
        id=str(result["id"]),
        task_id=str(result["task_id"]),
        diagnosis=result["diagnosis"],
        details=result.get("details"),
        created_at=str(result["created_at"]),
    )


@router.post("/action/{task_id}", response_model=ActionResponse)
async def action_endpoint(task_id: str, request: ActionRequest):
    """Record an action taken for a task.

    Args:
        task_id: Task UUID
        request: Action details including action type and result
    """
    db = get_db()

    # Validate action type
    if request.action not in VALID_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action. Must be one of: {', '.join(VALID_ACTIONS)}",
        )

    # Validate action result
    if request.action_result not in VALID_RESULTS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action_result. Must be one of: {', '.join(VALID_RESULTS)}",
        )

    # Verify task exists
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        result = await record_action(
            db,
            task_id=task_id,
            action=request.action,
            action_result=request.action_result,
            details=request.details,
        )
    except Exception as e:
        logger.error(f"Error recording action: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return ActionResponse(
        id=str(result["id"]),
        task_id=str(result["task_id"]),
        action=result["action"],
        action_result=result["action_result"],
        details=result.get("details"),
        created_at=str(result["created_at"]),
    )


@router.get("/logs", response_model=PatrolLogsResponse)
async def logs_endpoint(
    task_id: Optional[str] = None,
    diagnosis: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """Get patrol logs with optional filtering.

    Args:
        task_id: Filter by task ID
        diagnosis: Filter by diagnosis type
        limit: Maximum logs to return (default: 50)
        offset: Number of logs to skip (default: 0)
    """
    db = get_db()

    try:
        logs = await get_patrol_logs(
            db,
            task_id=task_id,
            diagnosis=diagnosis,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        logger.error(f"Error getting patrol logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return PatrolLogsResponse(
        logs=[
            PatrolLogResponse(
                id=str(log["id"]),
                task_id=str(log["task_id"]) if log.get("task_id") else None,
                diagnosis=log["diagnosis"],
                action=log.get("action"),
                action_result=log.get("action_result"),
                details=log.get("details"),
                created_at=str(log["created_at"]),
            )
            for log in logs
        ],
        total=len(logs),
    )


@router.get("/summary", response_model=PatrolSummaryResponse)
async def summary_endpoint():
    """Get patrol activity summary.

    Returns statistics about stale tasks and patrol actions
    from the last 24 hours.
    """
    db = get_db()

    try:
        summary = await get_patrol_summary(db)
    except Exception as e:
        logger.error(f"Error getting patrol summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return PatrolSummaryResponse(**summary)
