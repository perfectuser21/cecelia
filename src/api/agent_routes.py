"""Agent Monitor API routes for real-time agent tracking.

Provides endpoints to view agent runs and events.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.db.pool import Database
from src.state.agent_monitor import (
    get_runs,
    get_run,
    get_events,
    get_runs_summary,
    get_active_runs,
    STATUS_RUNNING,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_STALE,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])

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


# Response models
class AgentRunResponse(BaseModel):
    """Agent run response."""

    id: str
    agent_id: str
    output_file: str
    project: Optional[str] = None
    source: str = "claude_code"
    status: str = "running"
    current_tool: Optional[str] = None
    last_result: Optional[str] = None
    last_seq: int = 0
    turn_count: int = 0
    last_heartbeat_at: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None
    cecelia_run_id: Optional[str] = None


class AgentRunsResponse(BaseModel):
    """Response for runs list."""

    runs: List[AgentRunResponse]
    total: int


class AgentEventResponse(BaseModel):
    """Agent event response."""

    id: str
    run_id: str
    seq: int
    type: str
    tool_name: Optional[str] = None
    payload: Dict[str, Any]
    created_at: Optional[str] = None


class AgentEventsResponse(BaseModel):
    """Response for events list."""

    events: List[AgentEventResponse]
    total: int
    last_seq: int


class AgentSummaryResponse(BaseModel):
    """Agent runs summary."""

    by_status: Dict[str, int]
    total: int
    recent_count: int
    recent_runs: List[AgentRunResponse]


# Valid statuses
VALID_STATUSES = {STATUS_RUNNING, STATUS_COMPLETED, STATUS_FAILED, STATUS_STALE}


def _format_run(run: Dict[str, Any]) -> AgentRunResponse:
    """Format a run record for response."""
    return AgentRunResponse(
        id=str(run["id"]),
        agent_id=run["agent_id"],
        output_file=run["output_file"],
        project=run.get("project"),
        source=run.get("source", "claude_code"),
        status=run.get("status", "running"),
        current_tool=run.get("current_tool"),
        last_result=run.get("last_result"),
        last_seq=run.get("last_seq", 0),
        turn_count=run.get("turn_count", 0),
        last_heartbeat_at=str(run["last_heartbeat_at"]) if run.get("last_heartbeat_at") else None,
        started_at=str(run["started_at"]) if run.get("started_at") else None,
        updated_at=str(run["updated_at"]) if run.get("updated_at") else None,
        completed_at=str(run["completed_at"]) if run.get("completed_at") else None,
        cecelia_run_id=str(run["cecelia_run_id"]) if run.get("cecelia_run_id") else None,
    )


def _format_event(event: Dict[str, Any]) -> AgentEventResponse:
    """Format an event record for response."""
    payload = event.get("payload", {})
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {"raw": payload}

    return AgentEventResponse(
        id=str(event["id"]),
        run_id=str(event["run_id"]),
        seq=event["seq"],
        type=event["type"],
        tool_name=event.get("tool_name"),
        payload=payload,
        created_at=str(event["created_at"]) if event.get("created_at") else None,
    )


@router.get("/runs", response_model=AgentRunsResponse)
async def list_runs(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100, description="Maximum runs to return"),
    offset: int = Query(0, ge=0, description="Number to skip"),
):
    """List agent runs."""
    db = get_db()

    if status and status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}",
        )

    try:
        runs = await get_runs(db, status=status, limit=limit, offset=offset)
    except Exception as e:
        logger.error(f"Error getting runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return AgentRunsResponse(
        runs=[_format_run(run) for run in runs],
        total=len(runs),
    )


@router.get("/runs/active", response_model=AgentRunsResponse)
async def list_active_runs():
    """List all currently active (running) runs."""
    db = get_db()

    try:
        runs = await get_active_runs(db)
    except Exception as e:
        logger.error(f"Error getting active runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return AgentRunsResponse(
        runs=[_format_run(run) for run in runs],
        total=len(runs),
    )


@router.get("/runs/summary", response_model=AgentSummaryResponse)
async def runs_summary():
    """Get summary statistics for agent runs."""
    db = get_db()

    try:
        summary = await get_runs_summary(db)
    except Exception as e:
        logger.error(f"Error getting summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return AgentSummaryResponse(
        by_status=summary["by_status"],
        total=summary["total"],
        recent_count=summary["recent_count"],
        recent_runs=[_format_run(run) for run in summary["recent_runs"]],
    )


@router.get("/runs/{run_id}", response_model=AgentRunResponse)
async def get_run_detail(run_id: str):
    """Get details of a specific run."""
    db = get_db()

    try:
        run = await get_run(db, run_id)
    except Exception as e:
        logger.error(f"Error getting run: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return _format_run(run)


@router.get("/runs/{run_id}/events", response_model=AgentEventsResponse)
async def get_run_events(
    run_id: str,
    after_seq: int = Query(0, ge=0, description="Only events after this sequence"),
    limit: int = Query(100, ge=1, le=500, description="Maximum events to return"),
):
    """Get events for a specific run."""
    db = get_db()

    try:
        run = await get_run(db, run_id)
    except Exception as e:
        logger.error(f"Error verifying run: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    try:
        events = await get_events(db, run_id, after_seq=after_seq, limit=limit)
    except Exception as e:
        logger.error(f"Error getting events: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    last_seq = events[-1]["seq"] if events else after_seq

    return AgentEventsResponse(
        events=[_format_event(event) for event in events],
        total=len(events),
        last_seq=last_seq,
    )
