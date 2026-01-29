"""Orchestrator API routes for Cecelia Semantic Brain.

Exposes ~/runtime/state.json and related orchestrator state to the frontend.
"""

import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/orchestrator", tags=["orchestrator"])

# Paths
HOME = Path.home()
RUNTIME_DIR = HOME / "runtime"
STATE_FILE = RUNTIME_DIR / "state.json"
SUMMARY_FILE = RUNTIME_DIR / "summaries" / "latest.md"
LOGS_DIR = RUNTIME_DIR / "logs"


class UpdateFocusRequest(BaseModel):
    """Request to update focus."""
    project_key: Optional[str] = None
    repo_path: Optional[str] = None
    branch: Optional[str] = None
    intent: Optional[str] = None
    task_ref: Optional[str] = None


class AddDecisionRequest(BaseModel):
    """Request to add a decision."""
    decision: str
    reason: str
    context: Optional[str] = None


def read_state() -> Optional[Dict[str, Any]]:
    """Read state.json file."""
    if not STATE_FILE.exists():
        return None
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return None


def write_state(state: Dict[str, Any]) -> None:
    """Write state.json file."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def read_summary() -> Optional[str]:
    """Read latest summary file."""
    if not SUMMARY_FILE.exists():
        return None
    try:
        return SUMMARY_FILE.read_text()
    except Exception:
        return None


def get_warmup() -> Optional[str]:
    """Run cecelia-warmup --brief and return output."""
    try:
        result = subprocess.run(
            ["cecelia-warmup", "--brief"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout if result.returncode == 0 else None
    except Exception:
        return None


def get_recent_logs(lines: int = 50) -> Dict[str, str]:
    """Get recent terminal logs."""
    logs = {}
    if not LOGS_DIR.exists():
        return logs
    for log_file in LOGS_DIR.glob("*.stdout.log"):
        try:
            content = log_file.read_text()
            log_lines = content.strip().split("\n")
            logs[log_file.stem] = "\n".join(log_lines[-lines:])
        except Exception:
            pass
    return logs


@router.get("")
async def get_orchestrator():
    """Get full orchestrator status."""
    return {
        "success": True,
        "state": read_state(),
        "summary": read_summary(),
        "warmup": get_warmup(),
        "logs": get_recent_logs(30),
    }


@router.get("/state")
async def get_state():
    """Get only state.json."""
    state = read_state()
    if state is None:
        raise HTTPException(status_code=404, detail="state.json not found")
    return {"success": True, "state": state}


@router.get("/summary")
async def get_summary():
    """Get only latest summary."""
    return {"success": True, "summary": read_summary()}


@router.get("/warmup")
async def get_warmup_endpoint():
    """Get warmup output."""
    return {"success": True, "warmup": get_warmup()}


@router.get("/logs")
async def get_logs(lines: int = 50):
    """Get recent terminal logs."""
    return {"success": True, "logs": get_recent_logs(lines)}


@router.post("/focus")
async def update_focus(request: UpdateFocusRequest):
    """Update focus in state.json."""
    state = read_state()
    if state is None:
        raise HTTPException(status_code=404, detail="state.json not found")
    for key, value in request.model_dump(exclude_none=True).items():
        state["focus"][key] = value
    state["_meta"]["updated_at"] = datetime.now().isoformat()
    write_state(state)
    return {"success": True, "focus": state["focus"]}


@router.post("/decide")
async def add_decision(request: AddDecisionRequest):
    """Add a decision to memory."""
    state = read_state()
    if state is None:
        raise HTTPException(status_code=404, detail="state.json not found")
    new_decision = {
        "timestamp": datetime.now().isoformat(),
        "decision": request.decision,
        "reason": request.reason,
        "context": request.context or "",
    }
    state["memory"]["recent_decisions"] = [
        new_decision,
        *state["memory"]["recent_decisions"][:9]
    ]
    state["_meta"]["updated_at"] = datetime.now().isoformat()
    write_state(state)
    return {"success": True, "decision": new_decision}


@router.get("/health")
async def health():
    """Health check for orchestrator."""
    state_exists = STATE_FILE.exists()
    summary_exists = SUMMARY_FILE.exists()
    logs_exist = LOGS_DIR.exists() and any(LOGS_DIR.glob("*.log"))
    return {
        "success": True,
        "status": "healthy" if state_exists else "degraded",
        "checks": {
            "state_file": state_exists,
            "summary_file": summary_exists,
            "logs_directory": logs_exist,
        },
        "paths": {
            "state": str(STATE_FILE),
            "summary": str(SUMMARY_FILE),
            "logs": str(LOGS_DIR),
        },
    }
