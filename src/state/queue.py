"""PRD Queue Management.

Manages PRD execution queue for headless mode automation.
Migrated from cecelia-workspace/apps/core/src/brain/prd-queue.js
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.db.pool import Database

logger = logging.getLogger(__name__)

PRD_QUEUE_KEY = "prd_queue"


async def get_queue(db: Database) -> Dict[str, Any]:
    """Get current queue state.

    Args:
        db: Database instance

    Returns:
        Queue state dict with items, current_index, status, etc.
    """
    row = await db.fetchrow(
        "SELECT value_json FROM working_memory WHERE key = $1",
        PRD_QUEUE_KEY,
    )

    if not row:
        return {
            "items": [],
            "current_index": -1,
            "status": "idle",
            "started_at": None,
            "updated_at": None,
        }

    value = row["value_json"]
    if isinstance(value, str):
        return json.loads(value)
    return value


async def init_queue(
    db: Database,
    prd_paths: List[str],
    project_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Initialize queue from PRD file list.

    Args:
        db: Database instance
        prd_paths: List of PRD file paths
        project_path: Optional project directory path

    Returns:
        Initialized queue state
    """
    items = [
        {
            "id": index + 1,
            "path": path,
            "status": "pending",
            "pr_url": None,
            "branch": None,
            "started_at": None,
            "completed_at": None,
            "error": None,
        }
        for index, path in enumerate(prd_paths)
    ]

    queue = {
        "items": items,
        "current_index": 0,
        "status": "ready",
        "project_path": project_path,
        "started_at": None,
        "updated_at": datetime.utcnow().isoformat(),
    }

    await db.execute(
        """
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
        """,
        PRD_QUEUE_KEY,
        json.dumps(queue),
    )

    logger.info(f"[Queue] Initialized with {len(items)} PRDs")
    return queue


async def get_next_prd(db: Database) -> Optional[Dict[str, Any]]:
    """Get next pending PRD to execute.

    Args:
        db: Database instance

    Returns:
        Next PRD item with context, or None if none pending
    """
    queue = await get_queue(db)

    if queue["status"] == "idle" or not queue["items"]:
        return None

    # Find first pending PRD
    next_prd = next(
        (item for item in queue["items"] if item["status"] == "pending"),
        None,
    )

    if not next_prd:
        return None

    return {
        **next_prd,
        "project_path": queue.get("project_path"),
        "total": len(queue["items"]),
        "completed": sum(1 for i in queue["items"] if i["status"] == "done"),
    }


async def start_current_prd(db: Database) -> Dict[str, Any]:
    """Start executing current PRD.

    Args:
        db: Database instance

    Returns:
        Dict with success and started PRD info
    """
    queue = await get_queue(db)

    # Find first pending PRD
    next_prd = next(
        (item for item in queue["items"] if item["status"] == "pending"),
        None,
    )

    if not next_prd:
        return {"success": False, "error": "No pending PRD"}

    next_prd["status"] = "in_progress"
    next_prd["started_at"] = datetime.utcnow().isoformat()
    queue["status"] = "running"
    queue["started_at"] = queue.get("started_at") or datetime.utcnow().isoformat()
    queue["updated_at"] = datetime.utcnow().isoformat()

    await db.execute(
        """
        UPDATE working_memory SET value_json = $1, updated_at = NOW()
        WHERE key = $2
        """,
        json.dumps(queue),
        PRD_QUEUE_KEY,
    )

    logger.info(f"[Queue] Started PRD: {next_prd['path']}")
    return {"success": True, "prd": next_prd}


async def complete_prd(
    db: Database,
    prd_id: int,
    pr_url: Optional[str] = None,
    branch: Optional[str] = None,
) -> Dict[str, Any]:
    """Mark PRD as completed.

    Args:
        db: Database instance
        prd_id: PRD ID to complete
        pr_url: Optional PR URL
        branch: Optional branch name

    Returns:
        Dict with success, all_done status, and next PRD
    """
    queue = await get_queue(db)
    item = next((i for i in queue["items"] if i["id"] == prd_id), None)

    if not item:
        return {"success": False, "error": "PRD not found"}

    item["status"] = "done"
    item["pr_url"] = pr_url
    item["branch"] = branch
    item["completed_at"] = datetime.utcnow().isoformat()

    # Check if all done
    all_done = all(i["status"] == "done" for i in queue["items"])
    if all_done:
        queue["status"] = "completed"

    queue["updated_at"] = datetime.utcnow().isoformat()

    await db.execute(
        """
        UPDATE working_memory SET value_json = $1, updated_at = NOW()
        WHERE key = $2
        """,
        json.dumps(queue),
        PRD_QUEUE_KEY,
    )

    next_prd = next(
        (i for i in queue["items"] if i["status"] == "pending"),
        None,
    ) if not all_done else None

    logger.info(f"[Queue] Completed PRD: {prd_id}")
    return {"success": True, "all_done": all_done, "next": next_prd}


async def fail_prd(
    db: Database,
    prd_id: int,
    error: str,
) -> Dict[str, Any]:
    """Mark PRD as failed.

    Args:
        db: Database instance
        prd_id: PRD ID that failed
        error: Error message

    Returns:
        Dict with success and paused status
    """
    queue = await get_queue(db)
    item = next((i for i in queue["items"] if i["id"] == prd_id), None)

    if not item:
        return {"success": False, "error": "PRD not found"}

    item["status"] = "failed"
    item["error"] = error
    item["completed_at"] = datetime.utcnow().isoformat()

    queue["status"] = "paused"  # Pause queue on failure
    queue["updated_at"] = datetime.utcnow().isoformat()

    await db.execute(
        """
        UPDATE working_memory SET value_json = $1, updated_at = NOW()
        WHERE key = $2
        """,
        json.dumps(queue),
        PRD_QUEUE_KEY,
    )

    logger.info(f"[Queue] Failed PRD: {prd_id} - {error}")
    return {"success": True, "paused": True}


async def retry_failed(db: Database) -> Dict[str, Any]:
    """Retry all failed PRDs.

    Args:
        db: Database instance

    Returns:
        Dict with success status
    """
    queue = await get_queue(db)

    for item in queue["items"]:
        if item["status"] == "failed":
            item["status"] = "pending"
            item["error"] = None
            item["started_at"] = None
            item["completed_at"] = None

    queue["status"] = "ready"
    queue["updated_at"] = datetime.utcnow().isoformat()

    await db.execute(
        """
        UPDATE working_memory SET value_json = $1, updated_at = NOW()
        WHERE key = $2
        """,
        json.dumps(queue),
        PRD_QUEUE_KEY,
    )

    logger.info("[Queue] Retried failed PRDs")
    return {"success": True}


async def clear_queue(db: Database) -> Dict[str, Any]:
    """Clear the queue.

    Args:
        db: Database instance

    Returns:
        Dict with success status
    """
    await db.execute(
        "DELETE FROM working_memory WHERE key = $1",
        PRD_QUEUE_KEY,
    )

    logger.info("[Queue] Cleared queue")
    return {"success": True}


async def get_queue_summary(db: Database) -> Optional[Dict[str, Any]]:
    """Get queue summary for status endpoint.

    Args:
        db: Database instance

    Returns:
        Summary dict or None if queue is idle/empty
    """
    queue = await get_queue(db)

    if queue["status"] == "idle" or not queue["items"]:
        return None

    items = queue["items"]
    current = next(
        (i for i in items if i["status"] == "in_progress"),
        None,
    ) or next(
        (i for i in items if i["status"] == "pending"),
        None,
    )

    return {
        "status": queue["status"],
        "total": len(items),
        "pending": sum(1 for i in items if i["status"] == "pending"),
        "in_progress": sum(1 for i in items if i["status"] == "in_progress"),
        "done": sum(1 for i in items if i["status"] == "done"),
        "failed": sum(1 for i in items if i["status"] == "failed"),
        "current": current,
        "project_path": queue.get("project_path"),
        "started_at": queue.get("started_at"),
    }
