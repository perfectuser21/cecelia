"""Cecelia task execution API routes.

Provides /cecelia/overview and /cecelia/runs/{id} endpoints
for the frontend CeceliaRuns and RunDetail pages.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.db.pool import Database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cecelia", tags=["cecelia"])

_db: Optional[Database] = None

# Dev workflow steps (11 total)
DEV_STEPS = [
    {"id": "S1", "name": "PRD 确认"},
    {"id": "S2", "name": "环境检测"},
    {"id": "S3", "name": "分支创建"},
    {"id": "S4", "name": "DoD 定稿"},
    {"id": "S5", "name": "写代码"},
    {"id": "S6", "name": "写测试"},
    {"id": "S7", "name": "质检"},
    {"id": "S8", "name": "提交 PR"},
    {"id": "S9", "name": "CI 监控"},
    {"id": "S10", "name": "Learning"},
    {"id": "S11", "name": "清理"},
]

# Map DB status to frontend status
STATUS_MAP = {
    "queued": "pending",
    "in_progress": "running",
    "running": "running",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "failed",
}


def set_database(db: Database) -> None:
    global _db
    _db = db


def get_db() -> Database:
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not initialized")
    return _db


class TaskRunModel(BaseModel):
    id: str
    prd_path: Optional[str] = None
    project: str
    feature_branch: str
    status: str
    total_checkpoints: int
    completed_checkpoints: int
    failed_checkpoints: int
    current_checkpoint: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None
    mode: Optional[str] = None


class CheckpointModel(BaseModel):
    run_id: str
    checkpoint_id: str
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration: Optional[int] = None
    output: Optional[str] = None
    error: Optional[str] = None
    pr_url: Optional[str] = None


def _map_status(db_status: str) -> str:
    return STATUS_MAP.get(db_status, "pending")


def _infer_step_progress(task: Dict[str, Any]) -> tuple[int, int, int, Optional[str]]:
    """Infer dev step progress from task payload.

    Returns (total, completed, failed, current_step_name).
    """
    payload = task.get("payload") or {}
    status = task.get("status", "queued")
    total = len(DEV_STEPS)

    if status in ("completed",):
        return total, total, 0, None
    if status in ("failed", "cancelled"):
        current_step_str = payload.get("current_step")
        if current_step_str:
            try:
                step_idx = int(current_step_str)
                completed = max(0, step_idx - 1)
                name = DEV_STEPS[step_idx - 1]["name"] if 1 <= step_idx <= total else None
                return total, completed, 1, name
            except (ValueError, IndexError):
                pass
        return total, 0, 1, None
    if status in ("queued",):
        return total, 0, 0, DEV_STEPS[0]["name"]

    # in_progress / running
    current_step_str = payload.get("current_step")
    if current_step_str:
        try:
            step_idx = int(current_step_str)
            completed = max(0, step_idx - 1)
            name = DEV_STEPS[step_idx - 1]["name"] if 1 <= step_idx <= total else None
            return total, completed, 0, name
        except (ValueError, IndexError):
            pass
    # No step info - assume early stage
    return total, 0, 0, DEV_STEPS[0]["name"]


def _format_task_run(task: Dict[str, Any]) -> TaskRunModel:
    payload = task.get("payload") or {}
    total, completed, failed, current = _infer_step_progress(task)

    return TaskRunModel(
        id=str(task["id"]),
        prd_path=payload.get("prd_path"),
        project=task.get("title", "Unknown"),
        feature_branch=payload.get("feature_branch", ""),
        status=_map_status(task.get("status", "queued")),
        total_checkpoints=total,
        completed_checkpoints=completed,
        failed_checkpoints=failed,
        current_checkpoint=current,
        started_at=str(task["started_at"]) if task.get("started_at") else None,
        updated_at=str(task["updated_at"]) if task.get("updated_at") else None,
        completed_at=str(task["completed_at"]) if task.get("completed_at") else None,
        error=payload.get("error"),
        mode="headless" if payload.get("run_status") else None,
    )


def _build_checkpoints(task: Dict[str, Any]) -> List[CheckpointModel]:
    """Build checkpoint list from task data."""
    payload = task.get("payload") or {}
    status = task.get("status", "queued")
    run_id = str(task["id"])

    current_step_idx = 0
    current_step_str = payload.get("current_step")
    if current_step_str:
        try:
            current_step_idx = int(current_step_str)
        except ValueError:
            pass

    checkpoints = []
    for i, step in enumerate(DEV_STEPS):
        step_num = i + 1
        if status in ("completed",):
            cp_status = "done"
        elif status in ("failed", "cancelled"):
            if step_num < current_step_idx:
                cp_status = "done"
            elif step_num == current_step_idx:
                cp_status = "failed"
            else:
                cp_status = "skipped"
        elif status in ("queued",):
            cp_status = "pending"
        else:
            # in_progress
            if step_num < current_step_idx:
                cp_status = "done"
            elif step_num == current_step_idx:
                cp_status = "in_progress"
            else:
                cp_status = "pending"

        checkpoints.append(CheckpointModel(
            run_id=run_id,
            checkpoint_id=step["id"],
            status=cp_status,
        ))

    return checkpoints


@router.get("/overview")
async def get_overview(
    limit: int = Query(20, ge=1, le=100),
):
    """Get Cecelia task execution overview."""
    db = get_db()

    try:
        # Count by status
        counts = await db.fetch("""
            SELECT
                CASE
                    WHEN status IN ('in_progress', 'running') THEN 'running'
                    WHEN status = 'completed' THEN 'completed'
                    WHEN status IN ('failed', 'cancelled') THEN 'failed'
                    ELSE 'pending'
                END as mapped_status,
                count(*) as cnt
            FROM tasks
            WHERE status != 'cancelled'
            GROUP BY mapped_status
        """)

        status_counts = {row["mapped_status"]: row["cnt"] for row in counts}
        running = status_counts.get("running", 0)
        completed = status_counts.get("completed", 0)
        failed = status_counts.get("failed", 0)
        pending = status_counts.get("pending", 0)
        total = running + completed + failed + pending

        # Recent tasks
        rows = await db.fetch("""
            SELECT id, title, status, payload, started_at, updated_at, completed_at
            FROM tasks
            WHERE status != 'cancelled'
            ORDER BY
                CASE WHEN status IN ('in_progress', 'running') THEN 0 ELSE 1 END,
                updated_at DESC
            LIMIT $1
        """, limit)

        recent_runs = [_format_task_run(dict(row)) for row in rows]

        return {
            "success": True,
            "total_runs": total,
            "running": running,
            "completed": completed,
            "failed": failed,
            "recent_runs": [r.model_dump() for r in recent_runs],
        }
    except Exception as e:
        logger.error(f"Error fetching overview: {e}")
        return {"success": False, "error": str(e)}


@router.get("/runs/{run_id}")
async def get_run_detail(run_id: str):
    """Get details of a specific task run."""
    db = get_db()

    try:
        row = await db.fetchrow("""
            SELECT id, title, status, payload, started_at, updated_at, completed_at
            FROM tasks
            WHERE id = $1
        """, run_id)

        if not row:
            return {"success": False, "error": "任务不存在"}

        task = dict(row)
        run = _format_task_run(task)
        checkpoints = _build_checkpoints(task)

        return {
            "success": True,
            "run": run.model_dump(),
            "checkpoints": [cp.model_dump() for cp in checkpoints],
        }
    except Exception as e:
        logger.error(f"Error fetching run {run_id}: {e}")
        return {"success": False, "error": str(e)}
