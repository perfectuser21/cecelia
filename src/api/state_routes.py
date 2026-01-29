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
from src.state.goals import (
    list_objectives,
    list_key_results,
    get_goal,
    get_objective_with_tasks,
    delete_goal,
    update_objective_progress,
    get_goals_summary,
)

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


# Goals Models
class GoalListItem(BaseModel):
    """Goal item in list response."""

    id: str
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[int] = None
    project_id: Optional[str] = None
    target_date: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class GoalDetailResponse(BaseModel):
    """Detailed goal response."""

    id: str
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[int] = None
    type: Optional[str] = None
    parent_id: Optional[str] = None
    project_id: Optional[str] = None
    target_date: Optional[str] = None
    weight: Optional[float] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    key_results: Optional[List[Dict[str, Any]]] = None
    tasks: Optional[List[Dict[str, Any]]] = None
    calculated_progress: Optional[int] = None


class GoalDeleteResponse(BaseModel):
    """Response after deleting a goal."""

    success: bool
    deleted_id: Optional[str] = None
    error: Optional[str] = None


class GoalProgressResponse(BaseModel):
    """Response after recalculating progress."""

    success: bool
    progress: int
    reason: Optional[str] = None


class GoalsSummaryResponse(BaseModel):
    """Goals summary statistics."""

    objectives: Dict[str, Any]
    key_results: Dict[str, Any]


# Goals Endpoints
@router.get("/goals")
async def list_goals_endpoint(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = 50,
):
    """List all objectives.

    Args:
        status: Filter by status (pending/in_progress/completed)
        priority: Filter by priority (P0/P1/P2)
        project_id: Filter by project
        limit: Maximum results (default 50)
    """
    db = get_db()

    try:
        objectives = await list_objectives(
            db,
            status=status,
            priority=priority,
            project_id=project_id,
            limit=limit,
        )
    except Exception as e:
        logger.error(f"Error listing objectives: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return objectives


@router.get("/goals/summary", response_model=GoalsSummaryResponse)
async def get_goals_summary_endpoint(project_id: Optional[str] = None):
    """Get goals summary statistics.

    Args:
        project_id: Filter by project (optional)
    """
    db = get_db()

    try:
        summary = await get_goals_summary(db, project_id=project_id)
    except Exception as e:
        logger.error(f"Error getting goals summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return GoalsSummaryResponse(**summary)


@router.get("/goals/{goal_id}", response_model=GoalDetailResponse)
async def get_goal_endpoint(goal_id: str, include_tasks: bool = False):
    """Get a goal by ID.

    Args:
        goal_id: Goal ID
        include_tasks: Whether to include related tasks
    """
    db = get_db()

    try:
        if include_tasks:
            goal = await get_objective_with_tasks(db, goal_id)
        else:
            goal = await get_goal(db, goal_id)
    except Exception as e:
        logger.error(f"Error getting goal {goal_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    return GoalDetailResponse(**goal)


@router.get("/goals/{goal_id}/key-results")
async def get_goal_key_results_endpoint(
    goal_id: str,
    status: Optional[str] = None,
):
    """Get key results for an objective.

    Args:
        goal_id: Objective ID
        status: Filter by status (optional)
    """
    db = get_db()

    try:
        key_results = await list_key_results(db, goal_id, status=status)
    except Exception as e:
        logger.error(f"Error getting key results for {goal_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return key_results


@router.delete("/goals/{goal_id}", response_model=GoalDeleteResponse)
async def delete_goal_endpoint(goal_id: str, cascade: bool = False):
    """Delete a goal.

    Args:
        goal_id: Goal ID to delete
        cascade: If True, also delete child key results
    """
    db = get_db()

    try:
        result = await delete_goal(db, goal_id, cascade=cascade)
    except Exception as e:
        logger.error(f"Error deleting goal {goal_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))

    return GoalDeleteResponse(**result)


@router.post("/goals/{goal_id}/recalculate", response_model=GoalProgressResponse)
async def recalculate_goal_progress_endpoint(goal_id: str):
    """Recalculate objective progress from key results.

    Args:
        goal_id: Objective ID
    """
    db = get_db()

    try:
        result = await update_objective_progress(db, goal_id)
    except Exception as e:
        logger.error(f"Error recalculating progress for {goal_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return GoalProgressResponse(**result)
