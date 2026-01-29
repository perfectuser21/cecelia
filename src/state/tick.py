"""Action Loop - Tick Mechanism.

Implements automatic task progression through periodic ticks.
Migrated from cecelia-workspace/apps/core/src/brain/tick.js
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

from src.db.pool import Database
from src.state.focus import get_daily_focus

logger = logging.getLogger(__name__)

# Tick configuration
TICK_INTERVAL_MINUTES = 30
STALE_THRESHOLD_HOURS = 24  # Tasks in_progress for more than 24h are stale

# Working memory keys
TICK_ENABLED_KEY = "tick_enabled"
TICK_LAST_KEY = "tick_last"
TICK_ACTIONS_TODAY_KEY = "tick_actions_today"


def is_stale(task: Dict[str, Any]) -> bool:
    """Check if a task is stale (in_progress for too long).

    Args:
        task: Task record with status and started_at fields

    Returns:
        True if task is stale
    """
    if task.get("status") != "in_progress":
        return False

    started_at = task.get("started_at")
    if not started_at:
        return False

    if isinstance(started_at, str):
        started_at = datetime.fromisoformat(started_at.replace("Z", "+00:00"))

    hours_elapsed = (datetime.now(started_at.tzinfo) - started_at).total_seconds() / 3600
    return hours_elapsed > STALE_THRESHOLD_HOURS


async def get_tick_status(db: Database) -> Dict[str, Any]:
    """Get tick status.

    Args:
        db: Database instance

    Returns:
        Dict with enabled, interval, last_tick, next_tick, and actions_today
    """
    rows = await db.fetch(
        """
        SELECT key, value_json FROM working_memory
        WHERE key IN ($1, $2, $3)
        """,
        TICK_ENABLED_KEY,
        TICK_LAST_KEY,
        TICK_ACTIONS_TODAY_KEY,
    )

    memory: Dict[str, Any] = {}
    for row in rows:
        value = row["value_json"]
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                value = {}
        memory[row["key"]] = value

    enabled = memory.get(TICK_ENABLED_KEY, {}).get("enabled", False)
    last_tick = memory.get(TICK_LAST_KEY, {}).get("timestamp")
    actions_today = memory.get(TICK_ACTIONS_TODAY_KEY, {}).get("count", 0)

    # Calculate next tick time
    next_tick = None
    if enabled and last_tick:
        last_tick_dt = datetime.fromisoformat(last_tick.replace("Z", "+00:00"))
        next_tick = (last_tick_dt + timedelta(minutes=TICK_INTERVAL_MINUTES)).isoformat()
    elif enabled:
        next_tick = (datetime.utcnow() + timedelta(minutes=TICK_INTERVAL_MINUTES)).isoformat()

    return {
        "enabled": enabled,
        "interval_minutes": TICK_INTERVAL_MINUTES,
        "last_tick": last_tick,
        "next_tick": next_tick,
        "actions_today": actions_today,
    }


async def enable_tick(db: Database) -> Dict[str, Any]:
    """Enable automatic tick.

    Args:
        db: Database instance

    Returns:
        Dict with success and enabled status
    """
    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        TICK_ENABLED_KEY,
        json.dumps({"enabled": True}),
    )

    return {"success": True, "enabled": True}


async def disable_tick(db: Database) -> Dict[str, Any]:
    """Disable automatic tick.

    Args:
        db: Database instance

    Returns:
        Dict with success and enabled status
    """
    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        TICK_ENABLED_KEY,
        json.dumps({"enabled": False}),
    )

    return {"success": True, "enabled": False}


async def _log_tick_decision(
    db: Database,
    trigger: str,
    input_summary: str,
    decision: Dict[str, Any],
    result: Dict[str, Any],
) -> None:
    """Log a decision internally.

    Args:
        db: Database instance
        trigger: What triggered this decision
        input_summary: Summary of the input
        decision: The decision made
        result: The result of the action
    """
    await db.execute(
        """
        INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
        VALUES ($1, $2, $3, $4, $5)
        """,
        trigger,
        input_summary,
        json.dumps(decision),
        json.dumps(result),
        "success" if result.get("success") else "failed",
    )


async def _increment_actions_today(db: Database, count: int = 1) -> int:
    """Update actions count for today.

    Args:
        db: Database instance
        count: Number to increment by

    Returns:
        New count
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")

    row = await db.fetchrow(
        "SELECT value_json FROM working_memory WHERE key = $1",
        TICK_ACTIONS_TODAY_KEY,
    )

    current = {"date": today, "count": 0}
    if row and row["value_json"]:
        value = row["value_json"]
        if isinstance(value, str):
            try:
                current = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                pass
        else:
            current = value

    # Reset if new day
    new_count = current["count"] + count if current.get("date") == today else count

    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        TICK_ACTIONS_TODAY_KEY,
        json.dumps({"date": today, "count": new_count}),
    )

    return new_count


async def execute_tick(db: Database) -> Dict[str, Any]:
    """Execute a tick - the core decision loop.

    1. Get daily focus OKR
    2. Check related task status
    3. Decide next action
    4. Execute action
    5. Log decision

    Args:
        db: Database instance

    Returns:
        Dict with success, actions_taken, summary, and next_tick
    """
    from src.state.actions import update_task

    actions_taken: List[Dict[str, Any]] = []
    now = datetime.utcnow()

    # 1. Get daily focus
    focus_result = await get_daily_focus(db)

    if not focus_result:
        await _log_tick_decision(
            db,
            "tick",
            "No daily focus set",
            {"action": "skip", "reason": "no_focus"},
            {"success": True, "skipped": True},
        )
        return {
            "success": True,
            "actions_taken": [],
            "reason": "No active Objective to focus on",
            "next_tick": (now + timedelta(minutes=TICK_INTERVAL_MINUTES)).isoformat(),
        }

    focus = focus_result["focus"]
    objective_id = focus["objective"]["id"]

    # 2. Get tasks related to focus objective
    kr_ids = [kr["id"] for kr in focus.get("key_results", [])]
    all_goal_ids = [objective_id] + kr_ids

    tasks_rows = await db.fetch(
        """
        SELECT id, title, status, priority, started_at
        FROM tasks
        WHERE goal_id = ANY($1)
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          created_at ASC
        """,
        all_goal_ids,
    )

    tasks = [dict(row) for row in tasks_rows]

    # 3. Decision logic
    in_progress = [t for t in tasks if t.get("status") == "in_progress"]
    queued = [t for t in tasks if t.get("status") == "queued"]

    # Check for stale tasks
    stale_tasks = [t for t in tasks if is_stale(t)]
    for task in stale_tasks:
        await _log_tick_decision(
            db,
            "tick",
            f"Stale task detected: {task['title']}",
            {"action": "detect_stale", "task_id": task["id"]},
            {"success": True, "task_id": task["id"], "title": task["title"]},
        )
        actions_taken.append({
            "action": "detect_stale",
            "task_id": task["id"],
            "title": task["title"],
            "reason": f"Task has been in_progress for over {STALE_THRESHOLD_HOURS} hours",
        })

    # 4. Execute action: Start next task if nothing in progress
    if len(in_progress) == 0 and len(queued) > 0:
        next_task = queued[0]

        update_result = await update_task(
            db,
            task_id=next_task["id"],
            status="in_progress",
        )

        if update_result.get("success"):
            await _log_tick_decision(
                db,
                "tick",
                f"Started task: {next_task['title']}",
                {"action": "update-task", "task_id": next_task["id"], "status": "in_progress"},
                update_result,
            )
            actions_taken.append({
                "action": "update-task",
                "task_id": next_task["id"],
                "title": next_task["title"],
                "status": "in_progress",
            })
    elif len(in_progress) > 0:
        await _log_tick_decision(
            db,
            "tick",
            f"Waiting for {len(in_progress)} in-progress task(s)",
            {"action": "wait", "in_progress_count": len(in_progress)},
            {"success": True},
        )
    elif len(queued) == 0:
        await _log_tick_decision(
            db,
            "tick",
            "No queued tasks for focus objective",
            {"action": "skip", "reason": "no_queued_tasks"},
            {"success": True},
        )

    # 5. Update tick state
    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        TICK_LAST_KEY,
        json.dumps({"timestamp": now.isoformat()}),
    )

    # Update actions count
    if actions_taken:
        await _increment_actions_today(db, len(actions_taken))

    return {
        "success": True,
        "focus": {
            "objective_id": objective_id,
            "objective_title": focus["objective"].get("title"),
        },
        "actions_taken": actions_taken,
        "summary": {
            "in_progress": len(in_progress),
            "queued": len(queued),
            "stale": len(stale_tasks),
        },
        "next_tick": (now + timedelta(minutes=TICK_INTERVAL_MINUTES)).isoformat(),
    }
