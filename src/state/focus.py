"""Priority Engine - Daily Focus Selection.

Implements the "today's focus" selection logic for Brain.
Migrated from cecelia-workspace/apps/core/src/brain/focus.js
"""

import json
import logging
from typing import Any, Dict, List, Optional

from src.db.pool import Database

logger = logging.getLogger(__name__)

# Working memory key for manual focus override
FOCUS_OVERRIDE_KEY = "daily_focus_override"


def _generate_reason(objective: Dict[str, Any]) -> str:
    """Generate human-readable reason for focus selection.

    Args:
        objective: The selected objective record

    Returns:
        A string explaining why this objective was selected
    """
    reasons = []

    metadata = objective.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = {}

    if metadata.get("is_pinned"):
        reasons.append("已置顶")

    priority = objective.get("priority", "")
    if priority == "P0":
        reasons.append("P0 最高优先级")
    elif priority == "P1":
        reasons.append("P1 高优先级")

    progress = objective.get("progress", 0) or 0
    if progress >= 80:
        reasons.append(f"进度 {progress}%，接近完成")
    elif progress > 0:
        reasons.append(f"当前进度 {progress}%")

    if not reasons:
        reasons.append("最近有活动")

    return "，".join(reasons)


async def select_daily_focus(db: Database) -> Optional[Dict[str, Any]]:
    """Select daily focus using priority algorithm.

    Priority rules:
    1. Manually pinned Objective (is_pinned = true)
    2. Higher priority (P0 > P1 > P2)
    3. Near completion (80%+ progress - prioritize finishing)
    4. Recently active (most recent updated_at)

    Args:
        db: Database instance

    Returns:
        Dict with objective, reason, and is_manual flag, or None if no objectives
    """
    # Check for manual override first
    override_row = await db.fetchrow(
        "SELECT value_json FROM working_memory WHERE key = $1",
        FOCUS_OVERRIDE_KEY,
    )

    if override_row and override_row["value_json"]:
        value_json = override_row["value_json"]
        if isinstance(value_json, str):
            try:
                value_json = json.loads(value_json)
            except (json.JSONDecodeError, TypeError):
                value_json = {}

        objective_id = value_json.get("objective_id")
        if objective_id:
            # Fetch the manually set objective
            obj_row = await db.fetchrow(
                "SELECT * FROM goals WHERE id = $1 AND type = $2",
                objective_id,
                "objective",
            )

            if obj_row:
                return {
                    "objective": dict(obj_row),
                    "reason": "手动设置的焦点",
                    "is_manual": True,
                }

    # Auto-select using algorithm
    obj_row = await db.fetchrow(
        """
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY
          -- 1. Pinned first
          CASE WHEN (metadata->>'is_pinned')::boolean = true THEN 0 ELSE 1 END,
          -- 2. Priority order (P0 > P1 > P2)
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          -- 3. Near completion (80%+) gets priority boost
          CASE WHEN progress >= 80 THEN 0 ELSE 1 END,
          -- 4. Recently active
          updated_at DESC NULLS LAST
        LIMIT 1
        """
    )

    if not obj_row:
        return None

    objective = dict(obj_row)
    reason = _generate_reason(objective)

    return {
        "objective": objective,
        "reason": reason,
        "is_manual": False,
    }


async def get_daily_focus(db: Database) -> Optional[Dict[str, Any]]:
    """Get daily focus with full details.

    Args:
        db: Database instance

    Returns:
        Dict with focus details including objective, key_results, and suggested_tasks
    """
    focus_result = await select_daily_focus(db)

    if not focus_result:
        return None

    objective = focus_result["objective"]
    reason = focus_result["reason"]
    is_manual = focus_result["is_manual"]

    # Get Key Results for this Objective
    krs_rows = await db.fetch(
        "SELECT * FROM goals WHERE parent_id = $1 ORDER BY weight DESC, created_at ASC",
        objective["id"],
    )

    # Get suggested tasks (tasks linked to this objective or its KRs)
    kr_ids = [kr["id"] for kr in krs_rows]
    all_goal_ids = [objective["id"]] + kr_ids

    suggested_tasks: List[Dict[str, Any]] = []
    if all_goal_ids:
        tasks_rows = await db.fetch(
            """
            SELECT id, title, status, priority
            FROM tasks
            WHERE goal_id = ANY($1)
              AND status NOT IN ('completed', 'cancelled')
            ORDER BY
              CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
              created_at ASC
            LIMIT 5
            """,
            all_goal_ids,
        )
        suggested_tasks = [dict(row) for row in tasks_rows]

    return {
        "focus": {
            "objective": {
                "id": objective["id"],
                "title": objective.get("title"),
                "description": objective.get("description"),
                "priority": objective.get("priority"),
                "progress": objective.get("progress"),
                "status": objective.get("status"),
            },
            "key_results": [
                {
                    "id": kr["id"],
                    "title": kr.get("title"),
                    "progress": kr.get("progress"),
                    "weight": kr.get("weight"),
                    "status": kr.get("status"),
                }
                for kr in krs_rows
            ],
            "suggested_tasks": suggested_tasks,
        },
        "reason": reason,
        "is_manual": is_manual,
    }


async def set_daily_focus(db: Database, objective_id: str) -> Dict[str, Any]:
    """Manually set daily focus (override algorithm).

    Args:
        db: Database instance
        objective_id: The objective ID to set as focus

    Returns:
        Dict with success status and objective_id

    Raises:
        ValueError: If the objective is not found
    """
    # Verify objective exists
    obj_row = await db.fetchrow(
        "SELECT id FROM goals WHERE id = $1 AND type = $2",
        objective_id,
        "objective",
    )

    if not obj_row:
        raise ValueError("Objective not found")

    # Store override in working memory
    value_json = json.dumps({"objective_id": objective_id})
    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        FOCUS_OVERRIDE_KEY,
        value_json,
    )

    return {"success": True, "objective_id": objective_id}


async def clear_daily_focus(db: Database) -> Dict[str, Any]:
    """Clear manual focus override, restore auto-selection.

    Args:
        db: Database instance

    Returns:
        Dict with success status
    """
    await db.execute(
        "DELETE FROM working_memory WHERE key = $1",
        FOCUS_OVERRIDE_KEY,
    )

    return {"success": True}


async def get_focus_summary(db: Database) -> Optional[Dict[str, Any]]:
    """Get focus summary for Decision Pack.

    Args:
        db: Database instance

    Returns:
        Dict with focus summary or None
    """
    focus_result = await select_daily_focus(db)

    if not focus_result:
        return None

    objective = focus_result["objective"]
    reason = focus_result["reason"]
    is_manual = focus_result["is_manual"]

    # Get Key Results for this Objective (top 3)
    krs_rows = await db.fetch(
        "SELECT id, title, progress FROM goals WHERE parent_id = $1 ORDER BY weight DESC LIMIT 3",
        objective["id"],
    )

    return {
        "objective_id": objective["id"],
        "objective_title": objective.get("title"),
        "priority": objective.get("priority"),
        "progress": objective.get("progress"),
        "key_results": [dict(kr) for kr in krs_rows],
        "reason": reason,
        "is_manual": is_manual,
    }
