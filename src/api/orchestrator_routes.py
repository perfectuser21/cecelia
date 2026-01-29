"""Orchestrator API routes for Cecelia Semantic Brain.

Exposes ~/runtime/state.json, chat API, and voice API to the frontend.
"""

import base64
import json
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
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


class ChatRequest(BaseModel):
    """Request for chat endpoint."""
    message: str
    history: Optional[List[Dict[str, str]]] = None


class TTSRequest(BaseModel):
    """Request for TTS endpoint."""
    text: str
    voice_id: Optional[str] = "male-qn-qingse"
    speed: Optional[float] = 1.0


class STTRequest(BaseModel):
    """Request for STT endpoint."""
    audio: str  # base64 encoded audio


# MiniMax API configuration
MINIMAX_CREDENTIALS_PATH = HOME / ".credentials" / "minimax.json"
MINIMAX_TTS_URL = "https://api.minimax.chat/v1/t2a_v2"
MINIMAX_STT_URL = "https://api.minimax.chat/v1/audio/transcriptions"


def get_minimax_api_key() -> str:
    """Read MiniMax API key from credentials file."""
    if not MINIMAX_CREDENTIALS_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail="MiniMax credentials not found at ~/.credentials/minimax.json"
        )
    try:
        creds = json.loads(MINIMAX_CREDENTIALS_PATH.read_text())
        return creds["api_key"]
    except (json.JSONDecodeError, KeyError) as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read MiniMax API key: {e}"
        )


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


# Chat system prompt
CHAT_SYSTEM_PROMPT = """你是 Orchestrator，一个智能任务管理助手。你可以：

1. 查看和分析系统状态（Projects、OKR、Tasks）
2. 帮用户拆解需求为具体任务
3. 设置优先级和关联 OKR
4. 回答关于项目进度的问题

回复格式要求：
- 简洁直接，不要啰嗦
- 如果要引用具体对象，用 [[type:id:name]] 格式，如 [[okr:abc123:Brain MVP]]
- 如果建议创建任务，在回复最后加上 actions 数组

回复 JSON 格式：
{
  "message": "你的回复文本，可以包含 [[okr:id:name]] 引用",
  "highlights": ["okr:abc123", "task:def456"],
  "actions": [
    {
      "type": "create-task",
      "label": "创建任务: 设计登录 API",
      "params": { "title": "设计登录 API", "priority": "P1" }
    }
  ]
}"""


@router.post("/chat")
async def chat(request: ChatRequest):
    """Chat with Orchestrator using Claude CLI."""
    try:
        # Build full prompt with system context
        full_prompt = f"""{CHAT_SYSTEM_PROMPT}

用户消息：{request.message}

请用 JSON 格式回复。"""

        # Write prompt to temp file to avoid shell escaping issues
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False
        ) as f:
            f.write(full_prompt)
            prompt_file = f.name

        try:
            # Call claude CLI
            claude_path = HOME / ".local" / "bin" / "claude"
            result = subprocess.run(
                f'cat "{prompt_file}" | {claude_path} -p - --output-format text',
                shell=True,
                capture_output=True,
                text=True,
                timeout=90,
            )

            content = result.stdout.strip()

            # Try to parse JSON response
            try:
                # Extract JSON from response
                import re
                json_match = re.search(r"\{[\s\S]*\}", content)
                if json_match:
                    parsed = json.loads(json_match.group())
                else:
                    raise ValueError("No JSON found")
            except (json.JSONDecodeError, ValueError):
                # Wrap plain text in standard format
                parsed = {
                    "message": content,
                    "highlights": [],
                    "actions": []
                }

            return {"success": True, "response": parsed}

        finally:
            # Clean up temp file
            Path(prompt_file).unlink(missing_ok=True)

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Chat request timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")


@router.post("/voice/tts")
async def text_to_speech(request: TTSRequest):
    """Convert text to speech using MiniMax TTS API."""
    api_key = get_minimax_api_key()

    payload = {
        "model": "speech-01-turbo",
        "text": request.text,
        "voice_setting": {
            "voice_id": request.voice_id,
            "speed": request.speed,
        },
        "audio_setting": {
            "format": "mp3",
            "sample_rate": 32000,
        }
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            MINIMAX_TTS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"MiniMax TTS failed: {response.text}"
            )

        data = response.json()

        # MiniMax returns audio in base64
        if "data" in data and "audio" in data["data"]:
            return {
                "success": True,
                "audio": data["data"]["audio"],
                "format": "mp3"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Unexpected TTS response: {data}"
            )


@router.post("/voice/stt")
async def speech_to_text(request: STTRequest):
    """Convert speech to text using MiniMax STT API."""
    api_key = get_minimax_api_key()

    # Decode base64 audio
    try:
        audio_bytes = base64.b64decode(request.audio)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 audio: {e}")

    # Write to temp file for multipart upload
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        audio_file = f.name

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            with open(audio_file, "rb") as f:
                response = await client.post(
                    MINIMAX_STT_URL,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                    },
                    files={"file": ("audio.webm", f, "audio/webm")},
                    data={"model": "speech-01"},
                )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"MiniMax STT failed: {response.text}"
                )

            data = response.json()

            if "text" in data:
                return {"success": True, "text": data["text"]}
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Unexpected STT response: {data}"
                )

    finally:
        Path(audio_file).unlink(missing_ok=True)
