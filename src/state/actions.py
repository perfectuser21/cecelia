"""Brain Actions - Task and Goal Management.

Implements action handlers for the Brain API.
Migrated from cecelia-workspace/apps/core/src/brain/actions.js
"""

import json
import logging
from typing import Any, Dict, List, Optional

from src.db.pool import Database

logger = logging.getLogger(__name__)


async def create_task(
    db: Database,
    title: str,
    description: Optional[str] = None,
    priority: str = "P1",
    project_id: Optional[str] = None,
    goal_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Create a new task.

    Args:
        db: Database instance
        title: Task title
        description: Task description
        priority: Priority (P0/P1/P2)
        project_id: Associated project ID
        goal_id: Associated goal ID
        tags: List of tags

    Returns:
        Dict with success and task data
    """
    row = await db.fetchrow(
        """
        INSERT INTO tasks (title, description, priority, project_id, goal_id, tags, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'queued')
        RETURNING *
        """,
        title,
        description or "",
        priority,
        project_id,
        goal_id,
        tags or [],
    )

    task = dict(row)
    logger.info(f"[Action] Created task: {task['id']} - {title}")
    return {"success": True, "task": task}


async def update_task(
    db: Database,
    task_id: str,
    status: Optional[str] = None,
    priority: Optional[str] = None,
) -> Dict[str, Any]:
    """Update task status/priority.

    Args:
        db: Database instance
        task_id: Task ID to update
        status: New status
        priority: New priority

    Returns:
        Dict with success and task data
    """
    updates = []
    values = []
    idx = 1

    if status:
        updates.append(f"status = ${idx}")
        values.append(status)
        idx += 1

        # Update timestamps based on status
        if status == "in_progress":
            updates.append("started_at = NOW()")
        elif status == "completed":
            updates.append("completed_at = NOW()")

    if priority:
        updates.append(f"priority = ${idx}")
        values.append(priority)
        idx += 1

    if not updates:
        return {"success": False, "error": "No updates provided"}

    values.append(task_id)
    query = f"""
        UPDATE tasks SET {', '.join(updates)}
        WHERE id = ${idx}
        RETURNING *
    """

    row = await db.fetchrow(query, *values)

    if not row:
        return {"success": False, "error": "Task not found"}

    task = dict(row)
    logger.info(f"[Action] Updated task: {task_id}")
    return {"success": True, "task": task}


async def create_goal(
    db: Database,
    title: str,
    description: Optional[str] = None,
    priority: str = "P1",
    project_id: Optional[str] = None,
    target_date: Optional[str] = None,
    goal_type: str = "objective",
    parent_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a new goal.

    Args:
        db: Database instance
        title: Goal title
        description: Goal description
        priority: Priority (P0/P1/P2)
        project_id: Associated project ID
        target_date: Target completion date
        goal_type: Type (objective/key_result)
        parent_id: Parent goal ID (for key results)

    Returns:
        Dict with success and goal data
    """
    row = await db.fetchrow(
        """
        INSERT INTO goals (title, description, priority, project_id, target_date, type, parent_id, status, progress)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0)
        RETURNING *
        """,
        title,
        description or "",
        priority,
        project_id,
        target_date,
        goal_type,
        parent_id,
    )

    goal = dict(row)
    logger.info(f"[Action] Created goal: {goal['id']} - {title}")
    return {"success": True, "goal": goal}


async def update_goal(
    db: Database,
    goal_id: str,
    status: Optional[str] = None,
    progress: Optional[int] = None,
) -> Dict[str, Any]:
    """Update goal status/progress.

    Args:
        db: Database instance
        goal_id: Goal ID to update
        status: New status
        progress: New progress (0-100)

    Returns:
        Dict with success and goal data
    """
    updates = []
    values = []
    idx = 1

    if status:
        updates.append(f"status = ${idx}")
        values.append(status)
        idx += 1

    if progress is not None:
        updates.append(f"progress = ${idx}")
        values.append(progress)
        idx += 1

    if not updates:
        return {"success": False, "error": "No updates provided"}

    updates.append("updated_at = NOW()")
    values.append(goal_id)
    query = f"""
        UPDATE goals SET {', '.join(updates)}
        WHERE id = ${idx}
        RETURNING *
    """

    row = await db.fetchrow(query, *values)

    if not row:
        return {"success": False, "error": "Goal not found"}

    goal = dict(row)
    logger.info(f"[Action] Updated goal: {goal_id}")
    return {"success": True, "goal": goal}


async def set_memory(
    db: Database,
    key: str,
    value: Any,
) -> Dict[str, Any]:
    """Update working memory.

    Args:
        db: Database instance
        key: Memory key
        value: Value to store

    Returns:
        Dict with success, key, and value
    """
    value_json = json.dumps(value) if not isinstance(value, str) else value

    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        key,
        value_json,
    )

    logger.info(f"[Action] Set memory: {key}")
    return {"success": True, "key": key, "value": value}


async def log_decision(
    db: Database,
    trigger: str,
    input_summary: str,
    decision: Dict[str, Any],
    result: Dict[str, Any],
) -> Dict[str, Any]:
    """Log a decision (for audit trail).

    Args:
        db: Database instance
        trigger: What triggered the decision
        input_summary: Summary of the input
        decision: The decision made
        result: Result of the action

    Returns:
        Dict with success status
    """
    await db.execute(
        """
        INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
        VALUES ($1, $2, $3, $4, $5)
        """,
        trigger or "claude_code",
        input_summary or "",
        json.dumps(decision) if decision else "{}",
        json.dumps(result) if result else "{}",
        "success" if result and result.get("success") else "failed",
    )

    return {"success": True}


async def batch_update_tasks(
    db: Database,
    filter_criteria: Dict[str, Any],
    update_values: Dict[str, Any],
) -> Dict[str, Any]:
    """Batch update tasks (pause all, resume all, etc.).

    Args:
        db: Database instance
        filter_criteria: Filter conditions (status, priority, project_id)
        update_values: Values to update (status, priority)

    Returns:
        Dict with success and count of updated tasks
    """
    where_clauses = ["1=1"]
    values = []
    idx = 1

    # Build filter
    if filter_criteria.get("status"):
        where_clauses.append(f"status = ${idx}")
        values.append(filter_criteria["status"])
        idx += 1

    if filter_criteria.get("priority"):
        where_clauses.append(f"priority = ${idx}")
        values.append(filter_criteria["priority"])
        idx += 1

    if filter_criteria.get("project_id"):
        where_clauses.append(f"project_id = ${idx}")
        values.append(filter_criteria["project_id"])
        idx += 1

    # Build update
    updates = []
    if update_values.get("status"):
        updates.append(f"status = ${idx}")
        values.append(update_values["status"])
        idx += 1

    if update_values.get("priority"):
        updates.append(f"priority = ${idx}")
        values.append(update_values["priority"])
        idx += 1

    if not updates:
        return {"success": False, "error": "No updates provided"}

    query = f"""
        UPDATE tasks SET {', '.join(updates)}
        WHERE {' AND '.join(where_clauses)}
        RETURNING id
    """

    rows = await db.fetch(query, *values)
    count = len(rows)

    logger.info(f"[Action] Batch updated {count} tasks")
    return {"success": True, "count": count}


# Action dispatcher
ACTION_HANDLERS = {
    "create-task": create_task,
    "update-task": update_task,
    "create-goal": create_goal,
    "update-goal": update_goal,
    "set-memory": set_memory,
    "log-decision": log_decision,
    "batch-update-tasks": batch_update_tasks,
}


async def execute_action(
    db: Database,
    action_name: str,
    params: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute an action by name.

    Args:
        db: Database instance
        action_name: Name of the action to execute
        params: Parameters for the action

    Returns:
        Result of the action

    Raises:
        ValueError: If action is not found
    """
    handler = ACTION_HANDLERS.get(action_name)
    if not handler:
        raise ValueError(f"Unknown action: {action_name}")

    return await handler(db, **params)
