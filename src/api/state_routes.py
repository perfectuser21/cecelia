"""State API routes for Brain functionality.

Provides endpoints for Focus, Tick, and Actions (State Layer).
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.db.pool import Database
from src.state.focus import (
    get_daily_focus,
    set_daily_focus,
    clear_daily_focus,
    get_focus_summary,
)
from src.state.tick import (
    get_tick_status,
    enable_tick,
    disable_tick,
    execute_tick,
)
from src.state.actions import execute_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/brain", tags=["brain"])


# Request/Response models
class ObjectiveResponse(BaseModel):
    """Objective in focus response."""

    id: str
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    progress: Optional[int] = None
    status: Optional[str] = None


class KeyResultResponse(BaseModel):
    """Key result in focus response."""

    id: str
    title: Optional[str] = None
    progress: Optional[int] = None
    weight: Optional[float] = None
    status: Optional[str] = None


class SuggestedTaskResponse(BaseModel):
    """Suggested task in focus response."""

    id: str
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class FocusDetailResponse(BaseModel):
    """Focus detail containing objective, KRs, and tasks."""

    objective: ObjectiveResponse
    key_results: List[KeyResultResponse]
    suggested_tasks: List[SuggestedTaskResponse]


class FocusResponse(BaseModel):
    """Full focus response."""

    focus: FocusDetailResponse
    reason: str
    is_manual: bool


class FocusSummaryResponse(BaseModel):
    """Focus summary for Decision Pack."""

    objective_id: str
    objective_title: Optional[str] = None
    priority: Optional[str] = None
    progress: Optional[int] = None
    key_results: List[Dict[str, Any]]
    reason: str
    is_manual: bool


class SetFocusRequest(BaseModel):
    """Request to set focus manually."""

    objective_id: str


class SetFocusResponse(BaseModel):
    """Response after setting focus."""

    success: bool
    objective_id: str


class ClearFocusResponse(BaseModel):
    """Response after clearing focus."""

    success: bool


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


@router.get("/focus", response_model=FocusResponse)
async def get_focus():
    """Get current daily focus with full details.

    Returns the currently selected OKR objective as today's focus,
    along with its key results and suggested tasks.
    """
    db = get_db()

    try:
        result = await get_daily_focus(db)
    except Exception as e:
        logger.error(f"Error getting daily focus: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if result is None:
        raise HTTPException(status_code=404, detail="No focus objective found")

    return FocusResponse(
        focus=FocusDetailResponse(
            objective=ObjectiveResponse(**result["focus"]["objective"]),
            key_results=[
                KeyResultResponse(**kr) for kr in result["focus"]["key_results"]
            ],
            suggested_tasks=[
                SuggestedTaskResponse(**t) for t in result["focus"]["suggested_tasks"]
            ],
        ),
        reason=result["reason"],
        is_manual=result["is_manual"],
    )


@router.get("/focus/summary", response_model=FocusSummaryResponse)
async def get_focus_summary_endpoint():
    """Get focus summary for Decision Pack.

    Returns a lightweight summary of the current focus,
    suitable for including in the Brain status/decision pack.
    """
    db = get_db()

    try:
        result = await get_focus_summary(db)
    except Exception as e:
        logger.error(f"Error getting focus summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if result is None:
        raise HTTPException(status_code=404, detail="No focus objective found")

    return FocusSummaryResponse(**result)


@router.post("/focus/set", response_model=SetFocusResponse)
async def set_focus(request: SetFocusRequest):
    """Manually set the daily focus to a specific objective.

    This overrides the automatic focus selection algorithm
    until cleared.

    Args:
        request: Contains the objective_id to set as focus
    """
    db = get_db()

    try:
        result = await set_daily_focus(db, request.objective_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error setting daily focus: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return SetFocusResponse(**result)


@router.post("/focus/clear", response_model=ClearFocusResponse)
async def clear_focus():
    """Clear manual focus override.

    Restores automatic focus selection based on the
    priority algorithm.
    """
    db = get_db()

    try:
        result = await clear_daily_focus(db)
    except Exception as e:
        logger.error(f"Error clearing daily focus: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return ClearFocusResponse(**result)


# Tick Models
class TickStatusResponse(BaseModel):
    """Tick status response."""

    enabled: bool
    interval_minutes: int
    last_tick: Optional[str] = None
    next_tick: Optional[str] = None
    actions_today: int


class TickToggleResponse(BaseModel):
    """Response after enabling/disabling tick."""

    success: bool
    enabled: bool


class TickFocusInfo(BaseModel):
    """Focus info in tick result."""

    objective_id: str
    objective_title: Optional[str] = None


class TickActionTaken(BaseModel):
    """Action taken during tick."""

    action: str
    task_id: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    reason: Optional[str] = None


class TickSummary(BaseModel):
    """Summary of tick execution."""

    in_progress: int
    queued: int
    stale: int


class TickExecuteResponse(BaseModel):
    """Response after executing tick."""

    success: bool
    focus: Optional[TickFocusInfo] = None
    actions_taken: List[TickActionTaken]
    summary: Optional[TickSummary] = None
    reason: Optional[str] = None
    next_tick: str


# Action Models
class ActionRequest(BaseModel):
    """Request to execute an action."""

    params: Dict[str, Any]


class ActionResponse(BaseModel):
    """Response after executing action."""

    success: bool
    task: Optional[Dict[str, Any]] = None
    goal: Optional[Dict[str, Any]] = None
    key: Optional[str] = None
    value: Optional[Any] = None
    count: Optional[int] = None
    error: Optional[str] = None


# Tick Endpoints
@router.get("/tick/status", response_model=TickStatusResponse)
async def get_tick_status_endpoint():
    """Get current tick status.

    Returns whether automatic tick is enabled,
    the interval, and when the next tick will run.
    """
    db = get_db()

    try:
        result = await get_tick_status(db)
    except Exception as e:
        logger.error(f"Error getting tick status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return TickStatusResponse(**result)


@router.post("/tick/enable", response_model=TickToggleResponse)
async def enable_tick_endpoint():
    """Enable automatic tick.

    The tick mechanism will run periodically to
    automatically progress tasks.
    """
    db = get_db()

    try:
        result = await enable_tick(db)
    except Exception as e:
        logger.error(f"Error enabling tick: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return TickToggleResponse(**result)


@router.post("/tick/disable", response_model=TickToggleResponse)
async def disable_tick_endpoint():
    """Disable automatic tick.

    Stops the automatic task progression mechanism.
    """
    db = get_db()

    try:
        result = await disable_tick(db)
    except Exception as e:
        logger.error(f"Error disabling tick: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return TickToggleResponse(**result)


@router.post("/tick", response_model=TickExecuteResponse)
async def execute_tick_endpoint():
    """Execute a single tick manually.

    Runs the decision loop once:
    1. Get daily focus
    2. Check task status
    3. Decide and execute next action
    """
    db = get_db()

    try:
        result = await execute_tick(db)
    except Exception as e:
        logger.error(f"Error executing tick: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return TickExecuteResponse(
        success=result["success"],
        focus=TickFocusInfo(**result["focus"]) if result.get("focus") else None,
        actions_taken=[TickActionTaken(**a) for a in result.get("actions_taken", [])],
        summary=TickSummary(**result["summary"]) if result.get("summary") else None,
        reason=result.get("reason"),
        next_tick=result["next_tick"],
    )


# Action Endpoints
@router.post("/action/{action_name}", response_model=ActionResponse)
async def execute_action_endpoint(action_name: str, request: ActionRequest):
    """Execute a brain action by name.

    Available actions:
    - create-task: Create a new task
    - update-task: Update task status/priority
    - create-goal: Create a new goal
    - update-goal: Update goal status/progress
    - set-memory: Set working memory value
    - log-decision: Log a decision for audit
    - batch-update-tasks: Batch update tasks

    Args:
        action_name: Name of the action to execute
        request: Parameters for the action
    """
    db = get_db()

    try:
        result = await execute_action(db, action_name, request.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error executing action {action_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return ActionResponse(**result)
