"""Agent Monitor - Real-time monitoring of Claude Code agents.

Provides functionality to track agent runs, parse output files, and store events.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from src.db.pool import Database

logger = logging.getLogger(__name__)

# Event types
EVENT_USER_MESSAGE = "user_message"
EVENT_TOOL_USE = "tool_use"
EVENT_TOOL_RESULT = "tool_result"
EVENT_TEXT = "text"
EVENT_HOOK_PROGRESS = "hook_progress"

# Run statuses
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_STALE = "stale"

# Max length for last_result field
MAX_RESULT_LENGTH = 500


async def ensure_agent_tables(db: Database) -> None:
    """Create agent_runs and agent_events tables if not exist."""
    # Create agent_runs table
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id TEXT NOT NULL,
            output_file TEXT UNIQUE NOT NULL,
            project TEXT,
            source TEXT DEFAULT 'claude_code',
            status TEXT DEFAULT 'running',
            current_tool TEXT,
            last_result TEXT,
            last_seq INT DEFAULT 0,
            turn_count INT DEFAULT 0,
            last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
            started_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            cecelia_run_id UUID
        )
        """
    )

    await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_updated ON agent_runs(updated_at)"
    )

    # Create agent_events table
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id UUID NOT NULL,
            seq INT NOT NULL,
            type TEXT NOT NULL,
            tool_name TEXT,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT agent_events_run_seq_unique UNIQUE (run_id, seq)
        )
        """
    )

    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(type)"
    )

    logger.info("[AgentMonitor] Ensured agent tables exist")


def parse_output_line(line: str) -> Optional[Tuple[str, Dict[str, Any], Dict[str, Any]]]:
    """Parse a single JSON line from output file.

    Args:
        line: JSON string from output file

    Returns:
        Tuple of (event_type, payload, metadata) or None if parse fails
    """
    if not line.strip():
        return None

    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        logger.debug(f"[AgentMonitor] Failed to parse line: {line[:100]}...")
        return None

    msg_type = data.get("type")
    message = data.get("message", {})

    metadata = {
        "agent_id": data.get("agentId"),
        "session_id": data.get("sessionId"),
        "uuid": data.get("uuid"),
        "parent_uuid": data.get("parentUuid"),
        "timestamp": data.get("timestamp"),
        "cwd": data.get("cwd"),
        "git_branch": data.get("gitBranch"),
    }

    if msg_type == "user":
        content = message.get("content")
        if isinstance(content, str):
            return EVENT_USER_MESSAGE, {"content": content}, metadata
        elif isinstance(content, list):
            for item in content:
                if item.get("type") == "tool_result":
                    return EVENT_TOOL_RESULT, {
                        "tool_use_id": item.get("tool_use_id"),
                        "content": _truncate(item.get("content", ""), MAX_RESULT_LENGTH),
                        "is_error": item.get("is_error", False),
                    }, metadata
            return EVENT_USER_MESSAGE, {"content": content}, metadata

    elif msg_type == "assistant":
        content = message.get("content", [])
        if isinstance(content, list):
            for item in content:
                item_type = item.get("type")
                if item_type == "tool_use":
                    return EVENT_TOOL_USE, {
                        "id": item.get("id"),
                        "name": item.get("name"),
                        "input": item.get("input"),
                    }, metadata
                elif item_type == "text":
                    return EVENT_TEXT, {"text": item.get("text")}, metadata

    elif msg_type == "progress":
        progress_data = data.get("data", {})
        if progress_data.get("type") == "hook_progress":
            return EVENT_HOOK_PROGRESS, {
                "hook_event": progress_data.get("hookEvent"),
                "hook_name": progress_data.get("hookName"),
                "command": progress_data.get("command"),
            }, metadata

    return None


def _truncate(text: str, max_length: int) -> str:
    """Truncate text to max length."""
    if len(text) <= max_length:
        return text
    return text[:max_length - 3] + "..."


async def create_or_update_run(
    db: Database,
    agent_id: str,
    output_file: str,
    project: Optional[str] = None,
    source: str = "claude_code",
) -> Dict[str, Any]:
    """Create a new run or update existing one."""
    row = await db.fetchrow(
        """
        INSERT INTO agent_runs (agent_id, output_file, project, source)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (agent_id) DO UPDATE SET
            output_file = EXCLUDED.output_file,
            project = COALESCE(EXCLUDED.project, agent_runs.project),
            last_heartbeat_at = NOW(),
            updated_at = NOW()
        RETURNING *
        """,
        agent_id,
        output_file,
        project,
        source,
    )
    return dict(row)


async def record_event(
    db: Database,
    run_id: str,
    seq: int,
    event_type: str,
    payload: Dict[str, Any],
    tool_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Record an event for a run."""
    row = await db.fetchrow(
        """
        INSERT INTO agent_events (run_id, seq, type, tool_name, payload)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (run_id, seq) DO NOTHING
        RETURNING *
        """,
        run_id,
        seq,
        event_type,
        tool_name,
        json.dumps(payload),
    )
    return dict(row) if row else {}


async def update_run_from_event(
    db: Database,
    run_id: str,
    event_type: str,
    payload: Dict[str, Any],
    seq: int,
) -> None:
    """Update run status based on event."""
    updates = ["last_seq = $2", "updated_at = NOW()", "last_heartbeat_at = NOW()"]
    values: List[Any] = [run_id, seq]
    idx = 3

    if event_type == EVENT_TOOL_USE:
        tool_name = payload.get("name")
        updates.append(f"current_tool = ${idx}")
        values.append(tool_name)
        idx += 1
        updates.append(f"status = ${idx}")
        values.append(STATUS_RUNNING)
        idx += 1

    elif event_type == EVENT_TOOL_RESULT:
        content = payload.get("content", "")
        updates.append(f"last_result = ${idx}")
        values.append(_truncate(str(content), MAX_RESULT_LENGTH))
        idx += 1

    elif event_type == EVENT_TEXT:
        updates.append("turn_count = turn_count + 1")

    update_sql = ", ".join(updates)
    await db.execute(f"UPDATE agent_runs SET {update_sql} WHERE id = $1", *values)


async def get_runs(
    db: Database,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Get list of runs."""
    if status:
        rows = await db.fetch(
            """
            SELECT * FROM agent_runs
            WHERE status = $1
            ORDER BY updated_at DESC
            LIMIT $2 OFFSET $3
            """,
            status,
            limit,
            offset,
        )
    else:
        rows = await db.fetch(
            """
            SELECT * FROM agent_runs
            ORDER BY updated_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
    return [dict(row) for row in rows]


async def get_run(db: Database, run_id: str) -> Optional[Dict[str, Any]]:
    """Get a single run by ID."""
    row = await db.fetchrow("SELECT * FROM agent_runs WHERE id = $1", run_id)
    return dict(row) if row else None


async def get_run_by_agent_id(db: Database, agent_id: str) -> Optional[Dict[str, Any]]:
    """Get a run by agent ID."""
    row = await db.fetchrow("SELECT * FROM agent_runs WHERE agent_id = $1", agent_id)
    return dict(row) if row else None


async def get_events(
    db: Database,
    run_id: str,
    after_seq: int = 0,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Get events for a run."""
    rows = await db.fetch(
        """
        SELECT * FROM agent_events
        WHERE run_id = $1 AND seq > $2
        ORDER BY seq ASC
        LIMIT $3
        """,
        run_id,
        after_seq,
        limit,
    )
    return [dict(row) for row in rows]


async def complete_run(db: Database, run_id: str, status: str = STATUS_COMPLETED) -> None:
    """Mark a run as completed."""
    await db.execute(
        """
        UPDATE agent_runs
        SET status = $2, completed_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        run_id,
        status,
    )


async def get_active_runs(db: Database) -> List[Dict[str, Any]]:
    """Get all active (running) runs."""
    rows = await db.fetch(
        "SELECT * FROM agent_runs WHERE status = 'running' ORDER BY updated_at DESC"
    )
    return [dict(row) for row in rows]


async def get_runs_summary(db: Database) -> Dict[str, Any]:
    """Get summary statistics for runs."""
    status_rows = await db.fetch(
        "SELECT status, COUNT(*) as count FROM agent_runs GROUP BY status"
    )
    recent_rows = await db.fetch(
        """
        SELECT * FROM agent_runs
        WHERE updated_at > NOW() - INTERVAL '1 hour'
        ORDER BY updated_at DESC
        LIMIT 10
        """
    )
    return {
        "by_status": {row["status"]: row["count"] for row in status_rows},
        "total": sum(row["count"] for row in status_rows),
        "recent_count": len(recent_rows),
        "recent_runs": [dict(row) for row in recent_rows],
    }
