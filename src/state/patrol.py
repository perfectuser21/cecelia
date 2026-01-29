"""Patrol Agent - Monitor and recover stale Cecelia tasks.

Provides functionality to detect, diagnose, and recover from stale tasks.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.db.pool import Database

logger = logging.getLogger(__name__)

# Diagnosis types
DIAGNOSIS_STUCK_AFTER_SKILL = "stuck_after_skill"
DIAGNOSIS_CI_TIMEOUT = "ci_timeout"
DIAGNOSIS_PROCESS_DEAD = "process_dead"
DIAGNOSIS_NORMAL = "normal"
DIAGNOSIS_NEEDS_HUMAN = "needs_human"

# Action types
ACTION_RESTART = "restart"
ACTION_CONTINUE = "continue"
ACTION_MARK_HUMAN = "mark_human"
ACTION_NONE = "none"

# Action results
RESULT_SUCCESS = "success"
RESULT_FAILED = "failed"
RESULT_SKIPPED = "skipped"

# Thresholds
STALE_THRESHOLD_MINUTES = 30  # Task is stale if no update for 30 min
CI_TIMEOUT_MINUTES = 30  # CI is stuck if step 9 for 30 min


async def ensure_patrol_table(db: Database) -> None:
    """Create patrol_logs table if not exists.

    Args:
        db: Database instance
    """
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS patrol_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id UUID,
            diagnosis TEXT NOT NULL,
            action TEXT,
            action_result TEXT,
            details JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    logger.info("[Patrol] Ensured patrol_logs table exists")


async def get_stale_tasks(
    db: Database,
    threshold_minutes: int = STALE_THRESHOLD_MINUTES,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Get tasks that appear to be stale (stuck).

    A task is considered stale if:
    - Status is 'running' or 'in_progress'
    - Last update was more than threshold_minutes ago

    Args:
        db: Database instance
        threshold_minutes: Minutes of inactivity before considered stale
        limit: Maximum number of tasks to return

    Returns:
        List of stale task records
    """
    threshold = datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)

    rows = await db.fetch(
        """
        SELECT
            id,
            project,
            branch,
            prd_path,
            status,
            current_step,
            pid,
            started_at,
            updated_at,
            error,
            pr_url
        FROM cecelia_runs
        WHERE status IN ('running', 'in_progress')
          AND updated_at < $1
        ORDER BY updated_at ASC
        LIMIT $2
        """,
        threshold,
        limit,
    )

    return [dict(row) for row in rows]


async def get_task_by_id(
    db: Database,
    task_id: str,
) -> Optional[Dict[str, Any]]:
    """Get a task by ID.

    Args:
        db: Database instance
        task_id: Task UUID

    Returns:
        Task record or None
    """
    row = await db.fetchrow(
        """
        SELECT
            id,
            project,
            branch,
            prd_path,
            status,
            current_step,
            pid,
            started_at,
            updated_at,
            error,
            pr_url
        FROM cecelia_runs
        WHERE id = $1
        """,
        task_id,
    )

    return dict(row) if row else None


async def record_diagnosis(
    db: Database,
    task_id: str,
    diagnosis: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Record a patrol diagnosis for a task.

    Args:
        db: Database instance
        task_id: Task UUID
        diagnosis: Diagnosis type (stuck_after_skill, ci_timeout, etc.)
        details: Additional diagnosis details

    Returns:
        Created patrol log record
    """
    row = await db.fetchrow(
        """
        INSERT INTO patrol_logs (task_id, diagnosis, details)
        VALUES ($1, $2, $3)
        RETURNING id, task_id, diagnosis, details, created_at
        """,
        task_id,
        diagnosis,
        details or {},
    )

    result = dict(row)
    logger.info(f"[Patrol] Recorded diagnosis {diagnosis} for task {task_id}")
    return result


async def record_action(
    db: Database,
    task_id: str,
    action: str,
    action_result: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Record a patrol action taken for a task.

    Args:
        db: Database instance
        task_id: Task UUID
        action: Action type (restart, continue, mark_human, none)
        action_result: Result of action (success, failed, skipped)
        details: Additional action details

    Returns:
        Created patrol log record
    """
    row = await db.fetchrow(
        """
        INSERT INTO patrol_logs (task_id, diagnosis, action, action_result, details)
        VALUES ($1, 'action_taken', $2, $3, $4)
        RETURNING id, task_id, action, action_result, details, created_at
        """,
        task_id,
        action,
        action_result,
        details or {},
    )

    result = dict(row)
    logger.info(
        f"[Patrol] Recorded action {action} ({action_result}) for task {task_id}"
    )
    return result


async def get_patrol_logs(
    db: Database,
    task_id: Optional[str] = None,
    diagnosis: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Get patrol logs with optional filtering.

    Args:
        db: Database instance
        task_id: Filter by task ID
        diagnosis: Filter by diagnosis type
        limit: Maximum number of logs to return
        offset: Number of logs to skip

    Returns:
        List of patrol log records
    """
    where_clauses = []
    values = []
    idx = 1

    if task_id:
        where_clauses.append(f"task_id = ${idx}")
        values.append(task_id)
        idx += 1

    if diagnosis:
        where_clauses.append(f"diagnosis = ${idx}")
        values.append(diagnosis)
        idx += 1

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    values.extend([limit, offset])

    query = f"""
        SELECT
            id,
            task_id,
            diagnosis,
            action,
            action_result,
            details,
            created_at
        FROM patrol_logs
        {where_sql}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """

    rows = await db.fetch(query, *values)
    return [dict(row) for row in rows]


async def get_patrol_summary(
    db: Database,
) -> Dict[str, Any]:
    """Get patrol activity summary.

    Args:
        db: Database instance

    Returns:
        Summary statistics
    """
    # Get counts by diagnosis
    diagnosis_rows = await db.fetch(
        """
        SELECT diagnosis, COUNT(*) as count
        FROM patrol_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY diagnosis
        """
    )

    # Get counts by action result
    action_rows = await db.fetch(
        """
        SELECT action_result, COUNT(*) as count
        FROM patrol_logs
        WHERE action_result IS NOT NULL
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY action_result
        """
    )

    # Get stale task count
    stale_tasks = await get_stale_tasks(db, limit=100)

    return {
        "stale_task_count": len(stale_tasks),
        "diagnoses_24h": {row["diagnosis"]: row["count"] for row in diagnosis_rows},
        "actions_24h": {row["action_result"]: row["count"] for row in action_rows},
        "last_patrol": datetime.now(timezone.utc).isoformat(),
    }
