"""OKR Goals Management - CRUD operations for Objectives and Key Results.

Provides comprehensive goal management functionality for the Brain API.
"""

import logging
from typing import Any, Dict, List, Optional

from src.db.pool import Database

logger = logging.getLogger(__name__)


async def list_objectives(
    db: Database,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """List all objectives (top-level goals).

    Args:
        db: Database instance
        status: Filter by status (pending/in_progress/completed)
        priority: Filter by priority (P0/P1/P2)
        project_id: Filter by project
        limit: Maximum results to return

    Returns:
        List of objective records
    """
    where_clauses = ["type = 'objective'", "parent_id IS NULL"]
    values = []
    idx = 1

    if status:
        where_clauses.append(f"status = ${idx}")
        values.append(status)
        idx += 1

    if priority:
        where_clauses.append(f"priority = ${idx}")
        values.append(priority)
        idx += 1

    if project_id:
        where_clauses.append(f"project_id = ${idx}")
        values.append(project_id)
        idx += 1

    values.append(limit)
    query = f"""
        SELECT id, title, description, priority, status, progress,
               project_id, target_date, created_at, updated_at
        FROM goals
        WHERE {' AND '.join(where_clauses)}
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          created_at DESC
        LIMIT ${idx}
    """

    rows = await db.fetch(query, *values)
    return [dict(row) for row in rows]


async def list_key_results(
    db: Database,
    objective_id: str,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List key results for an objective.

    Args:
        db: Database instance
        objective_id: Parent objective ID
        status: Filter by status

    Returns:
        List of key result records
    """
    where_clauses = ["parent_id = $1"]
    values = [objective_id]
    idx = 2

    if status:
        where_clauses.append(f"status = ${idx}")
        values.append(status)

    query = f"""
        SELECT id, title, description, priority, status, progress,
               weight, target_date, created_at, updated_at
        FROM goals
        WHERE {' AND '.join(where_clauses)}
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          created_at ASC
    """

    rows = await db.fetch(query, *values)
    return [dict(row) for row in rows]


async def get_goal(
    db: Database,
    goal_id: str,
    include_key_results: bool = True,
) -> Optional[Dict[str, Any]]:
    """Get a goal by ID with optional key results.

    Args:
        db: Database instance
        goal_id: Goal ID
        include_key_results: Whether to include child key results

    Returns:
        Goal record with optional key_results array, or None
    """
    row = await db.fetchrow(
        """
        SELECT id, title, description, priority, status, progress,
               type, parent_id, project_id, target_date, weight,
               created_at, updated_at
        FROM goals
        WHERE id = $1
        """,
        goal_id,
    )

    if not row:
        return None

    goal = dict(row)

    # Include key results if it's an objective
    if include_key_results and goal.get("type") == "objective":
        key_results = await list_key_results(db, goal_id)
        goal["key_results"] = key_results

    return goal


async def get_objective_with_tasks(
    db: Database,
    objective_id: str,
    task_limit: int = 10,
) -> Optional[Dict[str, Any]]:
    """Get objective with its key results and related tasks.

    Args:
        db: Database instance
        objective_id: Objective ID
        task_limit: Max tasks per goal

    Returns:
        Objective with key_results and tasks
    """
    objective = await get_goal(db, objective_id, include_key_results=True)
    if not objective:
        return None

    # Get tasks for objective
    all_goal_ids = [objective_id]
    if objective.get("key_results"):
        all_goal_ids.extend([kr["id"] for kr in objective["key_results"]])

    tasks_rows = await db.fetch(
        """
        SELECT id, title, status, priority, goal_id, started_at, completed_at
        FROM tasks
        WHERE goal_id = ANY($1)
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          created_at ASC
        LIMIT $2
        """,
        all_goal_ids,
        task_limit,
    )

    objective["tasks"] = [dict(row) for row in tasks_rows]

    # Calculate aggregate progress
    if objective.get("key_results"):
        total_weight = sum(kr.get("weight", 1) for kr in objective["key_results"])
        weighted_progress = sum(
            kr.get("progress", 0) * kr.get("weight", 1)
            for kr in objective["key_results"]
        )
        objective["calculated_progress"] = (
            int(weighted_progress / total_weight) if total_weight > 0 else 0
        )

    return objective


async def delete_goal(
    db: Database,
    goal_id: str,
    cascade: bool = False,
) -> Dict[str, Any]:
    """Delete a goal.

    Args:
        db: Database instance
        goal_id: Goal ID to delete
        cascade: If True, also delete child key results

    Returns:
        Dict with success status
    """
    # Check if goal exists
    row = await db.fetchrow(
        "SELECT id, type FROM goals WHERE id = $1",
        goal_id,
    )

    if not row:
        return {"success": False, "error": "Goal not found"}

    goal_type = row["type"]

    # Check for children if objective
    if goal_type == "objective" and not cascade:
        children = await db.fetchrow(
            "SELECT COUNT(*) as count FROM goals WHERE parent_id = $1",
            goal_id,
        )
        if children and children["count"] > 0:
            return {
                "success": False,
                "error": f"Goal has {children['count']} key results. Use cascade=true to delete.",
            }

    # Delete children first if cascade
    if cascade and goal_type == "objective":
        await db.execute(
            "DELETE FROM goals WHERE parent_id = $1",
            goal_id,
        )

    # Delete the goal
    await db.execute(
        "DELETE FROM goals WHERE id = $1",
        goal_id,
    )

    logger.info(f"[Goals] Deleted goal: {goal_id}")
    return {"success": True, "deleted_id": goal_id}


async def update_objective_progress(
    db: Database,
    objective_id: str,
) -> Dict[str, Any]:
    """Recalculate and update objective progress from key results.

    Args:
        db: Database instance
        objective_id: Objective ID

    Returns:
        Dict with success and new progress
    """
    # Get key results
    key_results = await list_key_results(db, objective_id)

    if not key_results:
        return {"success": True, "progress": 0, "reason": "No key results"}

    # Calculate weighted average
    total_weight = sum(kr.get("weight", 1) for kr in key_results)
    weighted_progress = sum(
        kr.get("progress", 0) * kr.get("weight", 1) for kr in key_results
    )

    new_progress = int(weighted_progress / total_weight) if total_weight > 0 else 0

    # Update objective
    await db.execute(
        """
        UPDATE goals SET progress = $1, updated_at = NOW()
        WHERE id = $2
        """,
        new_progress,
        objective_id,
    )

    logger.info(f"[Goals] Updated objective {objective_id} progress to {new_progress}%")
    return {"success": True, "progress": new_progress}


async def get_goals_summary(
    db: Database,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Get summary statistics for goals.

    Args:
        db: Database instance
        project_id: Filter by project

    Returns:
        Dict with objectives and key_results counts by status
    """
    values = []

    # Get objectives summary
    if project_id:
        obj_query = """
            SELECT status, COUNT(*) as count
            FROM goals
            WHERE type = 'objective' AND project_id = $1
            GROUP BY status
        """
        values = [project_id]
    else:
        obj_query = """
            SELECT status, COUNT(*) as count
            FROM goals
            WHERE type = 'objective'
            GROUP BY status
        """

    obj_rows = await db.fetch(obj_query, *values)
    objectives = {row["status"]: row["count"] for row in obj_rows}

    # Get key results summary
    if project_id:
        kr_query = """
            SELECT status, COUNT(*) as count
            FROM goals
            WHERE type = 'key_result' AND project_id = $1
            GROUP BY status
        """
    else:
        kr_query = """
            SELECT status, COUNT(*) as count
            FROM goals
            WHERE type = 'key_result'
            GROUP BY status
        """

    kr_rows = await db.fetch(kr_query, *values)
    key_results = {row["status"]: row["count"] for row in kr_rows}

    return {
        "objectives": {
            "total": sum(objectives.values()),
            "by_status": objectives,
        },
        "key_results": {
            "total": sum(key_results.values()),
            "by_status": key_results,
        },
    }
