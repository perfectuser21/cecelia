"""Orchestrator API routes for Cecelia Semantic Brain.

Exposes ~/runtime/state.json, chat API, voice API, and realtime WebSocket to the frontend.
"""

import asyncio
import base64
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import websockets
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from src.db.pool import Database
from src.orchestrator.models import TRD
from src.orchestrator.planner import Planner
from src.orchestrator.state_machine import StateMachine, StateTransitionError
from src.orchestrator import routes as orchestrator_v2

# Database dependency - will be set by main.py
_db: Optional[Database] = None


def set_database(db: Database) -> None:
    """Set the database instance for routes."""
    global _db
    _db = db


def get_db() -> Database:
    """Get the database instance."""
    if _db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")
    return _db


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


class ToolCallRequest(BaseModel):
    """Request for tool execution."""
    tool_name: str
    arguments: Dict[str, Any] = {}


# MiniMax API configuration
MINIMAX_CREDENTIALS_PATH = HOME / ".credentials" / "minimax.json"
MINIMAX_TTS_URL = "https://api.minimax.chat/v1/t2a_v2"
MINIMAX_STT_URL = "https://api.minimax.chat/v1/audio/transcriptions"

# OpenAI API configuration (Realtime Voice)
OPENAI_CREDENTIALS_PATH = HOME / ".credentials" / "openai.json"
OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime"


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


def get_openai_api_key() -> str:
    """Read OpenAI API key from credentials file."""
    if not OPENAI_CREDENTIALS_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail="OpenAI credentials not found at ~/.credentials/openai.json"
        )
    try:
        creds = json.loads(OPENAI_CREDENTIALS_PATH.read_text())
        return creds["api_key"]
    except (json.JSONDecodeError, KeyError) as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read OpenAI API key: {e}"
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
            # Call claude CLI with Haiku model (Cecelia = lightweight entry point)
            claude_path = HOME / ".local" / "bin" / "claude"
            result = subprocess.run(
                f'cat "{prompt_file}" | {claude_path} -p - --model haiku --output-format text',
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


# ============================================================================
# OpenAI Realtime API (WebSocket)
# ============================================================================

@router.get("/realtime/config")
async def get_realtime_config():
    """Get OpenAI Realtime API configuration for frontend WebSocket connection."""
    api_key = get_openai_api_key()
    return {
        "success": True,
        "provider": "openai",
        "config": {
            "url": OPENAI_REALTIME_URL,
            "api_key": api_key,
            "model": "gpt-4o-mini-realtime-preview",
            "voice": "alloy",
            "instructions": """You are Cecelia (塞西莉亚), the voice/text entry point for the system.

AGENT TEAM:
- Cecelia (你) = 入口，理解用户意图，分发任务
- Autumnrice (秋米) = 管家/调度，用 call_autumnrice 调用
- Caramel (焦糖) = 编程肌肉（未来）
- Nobel (诺贝) = 自动化肌肉（N8N）

CRITICAL RULE - When to call call_autumnrice:
- User says "启动秋米/autumnrice/指挥官" or any variation
- User says "帮我做/创建/实现 XXX功能"
- User says "让大脑去做/执行 XXX"
- User says "查一下服务器/VPS信息"
- User asks you to DO something (not just query)

CRITICAL RULE - When to use query tools:
- User asks "有哪些任务/OKR/项目" → use get_tasks/get_okrs/get_projects
- User asks "打开/显示/看看 XXX" → use open_detail

Examples:
- "启动秋米查VPS" → call_autumnrice(task="查询VPS服务器信息")
- "帮我做登录功能" → call_autumnrice(task="做一个登录功能")
- "查一下服务器" → call_autumnrice(task="查询VPS服务器信息")
- "看看Brain MVP" → open_detail(type="okr", name="Brain MVP")

ALWAYS call call_autumnrice when user wants you to EXECUTE or DO something.
Respond in Chinese, be concise.""",
            "tools": [
                {
                    "type": "function",
                    "name": "get_okrs",
                    "description": "获取用户的 OKR 目标列表",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "description": "筛选状态",
                                "enum": ["pending", "in_progress", "completed"]
                            }
                        },
                        "required": []
                    }
                },
                {
                    "type": "function",
                    "name": "get_projects",
                    "description": "获取项目列表",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                },
                {
                    "type": "function",
                    "name": "get_tasks",
                    "description": "获取任务列表",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"]
                            },
                            "priority": {
                                "type": "string",
                                "enum": ["P0", "P1", "P2", "P3"]
                            }
                        },
                        "required": []
                    }
                },
                {
                    "type": "function",
                    "name": "open_detail",
                    "description": "打开 OKR/项目/任务的详情面板",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["okr", "project", "task"]
                            },
                            "name": {
                                "type": "string",
                                "description": "要查找的名称"
                            },
                            "id": {
                                "type": "string",
                                "description": "精确的 ID"
                            }
                        },
                        "required": ["type"]
                    }
                },
                {
                    "type": "function",
                    "name": "call_autumnrice",
                    "description": "Call Autumnrice (秋米) - the orchestrator/manager agent using Opus model. MUST call this when user says: 启动秋米, 启动orchestrator, 启动指挥官, autostrator, ultrastrator, 帮我做XXX, 创建XXX, 查服务器, 查VPS, or any request to DO/EXECUTE something.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task": {
                                "type": "string",
                                "description": "用户要完成的任务描述"
                            },
                            "priority": {
                                "type": "string",
                                "enum": ["P0", "P1", "P2"],
                                "default": "P1"
                            },
                            "project": {
                                "type": "string",
                                "description": "指定项目名称"
                            }
                        },
                        "required": ["task"]
                    }
                }
            ]
        }
    }


@router.websocket("/realtime/ws")
async def realtime_websocket_proxy(websocket: WebSocket):
    """WebSocket proxy for OpenAI Realtime API."""
    await websocket.accept()

    try:
        api_key = get_openai_api_key()
    except HTTPException as e:
        await websocket.send_json({"type": "error", "error": {"message": e.detail}})
        await websocket.close()
        return

    openai_url = f"{OPENAI_REALTIME_URL}?model=gpt-4o-mini-realtime-preview"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "realtime=v1",
    }

    try:
        print(f"[Realtime Proxy] Connecting to OpenAI: {openai_url}")
        async with websockets.connect(
            openai_url,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=10,
        ) as openai_ws:
            print("[Realtime Proxy] Connected to OpenAI successfully")

            async def browser_to_openai():
                """Forward messages from browser to OpenAI."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        await openai_ws.send(data)
                except WebSocketDisconnect:
                    print("[Realtime Proxy] Browser disconnected")
                except Exception as e:
                    print(f"[Realtime Proxy] Browser->OpenAI error: {e}")

            async def openai_to_browser():
                """Forward messages from OpenAI to browser."""
                try:
                    async for message in openai_ws:
                        await websocket.send_text(message)
                except Exception as e:
                    print(f"[Realtime Proxy] OpenAI->Browser error: {e}")

            await asyncio.gather(
                browser_to_openai(),
                openai_to_browser(),
                return_exceptions=True
            )

    except websockets.exceptions.InvalidStatusCode as e:
        error_msg = f"OpenAI connection failed: HTTP {e.status_code}"
        print(f"[Realtime Proxy] {error_msg}")
        try:
            await websocket.send_json({"type": "error", "error": {"message": error_msg}})
        except Exception:
            pass
    except Exception as e:
        error_msg = f"Connection error: {str(e)}"
        print(f"[Realtime Proxy] {error_msg}")
        try:
            await websocket.send_json({"type": "error", "error": {"message": error_msg}})
        except Exception:
            pass
    finally:
        print("[Realtime Proxy] Cleaning up connection")
        try:
            await websocket.close()
        except Exception:
            pass


@router.post("/realtime/tool")
async def execute_tool(request: ToolCallRequest):
    """Execute a tool call and return the result."""
    tool_name = request.tool_name
    args = request.arguments
    db = get_db()

    print(f"[Tool] Executing: {tool_name} with args: {args}")

    try:
        if tool_name == "get_okrs":
            status_filter = args.get("status")
            query = "SELECT id, title, status, priority, progress FROM goals"
            params = []
            if status_filter:
                query += " WHERE status = $1"
                params.append(status_filter)
            query += " ORDER BY priority, created_at DESC LIMIT 20"

            rows = await db.pool.fetch(query, *params)
            result = [
                {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "status": row["status"],
                    "priority": row["priority"],
                    "progress": row["progress"]
                }
                for row in rows
            ]
            return {"success": True, "result": result}

        elif tool_name == "get_projects":
            query = """
                SELECT id, name, repo_path
                FROM projects
                WHERE parent_id IS NULL
                ORDER BY name LIMIT 20
            """
            rows = await db.pool.fetch(query)
            result = [
                {
                    "id": str(row["id"]),
                    "name": row["name"],
                    "repo_path": row["repo_path"]
                }
                for row in rows
            ]
            return {"success": True, "result": result}

        elif tool_name == "get_tasks":
            status_filter = args.get("status")
            priority_filter = args.get("priority")

            query = "SELECT id, title, status, priority, goal_id FROM tasks WHERE 1=1"
            params = []
            param_idx = 1

            if status_filter:
                query += f" AND status = ${param_idx}"
                params.append(status_filter)
                param_idx += 1

            if priority_filter:
                query += f" AND priority = ${param_idx}"
                params.append(priority_filter)
                param_idx += 1

            query += " ORDER BY priority, created_at DESC LIMIT 20"

            rows = await db.pool.fetch(query, *params)
            result = [
                {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "status": row["status"],
                    "priority": row["priority"],
                    "goal_id": str(row["goal_id"]) if row["goal_id"] else None
                }
                for row in rows
            ]
            return {"success": True, "result": result}

        elif tool_name == "open_detail":
            item_type = args.get("type")
            item_name = args.get("name")
            item_id = args.get("id")

            if not item_type:
                return {"success": False, "error": "type is required"}

            row = None

            if item_type == "okr":
                if item_id:
                    row = await db.pool.fetchrow(
                        "SELECT id, title, status, priority, progress, description, content FROM goals WHERE id = $1",
                        item_id
                    )
                elif item_name:
                    row = await db.pool.fetchrow(
                        "SELECT id, title, status, priority, progress, description, content FROM goals WHERE title ILIKE $1 LIMIT 1",
                        f"%{item_name}%"
                    )

                if row:
                    content = row["content"]
                    if isinstance(content, str):
                        content = json.loads(content) if content else []
                    result = {
                        "action": "open_detail",
                        "type": "okr",
                        "data": {
                            "id": str(row["id"]),
                            "title": row["title"],
                            "status": row["status"],
                            "priority": row["priority"],
                            "progress": row["progress"],
                            "description": row["description"],
                            "content": content or []
                        }
                    }
                    return {"success": True, "result": result}

            elif item_type == "project":
                if item_id:
                    row = await db.pool.fetchrow(
                        "SELECT id, name, repo_path, description, content FROM projects WHERE id = $1",
                        item_id
                    )
                elif item_name:
                    row = await db.pool.fetchrow(
                        "SELECT id, name, repo_path, description, content FROM projects WHERE name ILIKE $1 LIMIT 1",
                        f"%{item_name}%"
                    )

                if row:
                    content = row["content"]
                    if isinstance(content, str):
                        content = json.loads(content) if content else []
                    result = {
                        "action": "open_detail",
                        "type": "project",
                        "data": {
                            "id": str(row["id"]),
                            "name": row["name"],
                            "repo_path": row["repo_path"],
                            "description": row["description"],
                            "content": content or []
                        }
                    }
                    return {"success": True, "result": result}

            elif item_type == "task":
                if item_id:
                    row = await db.pool.fetchrow(
                        "SELECT id, title, status, priority, goal_id, description, content FROM tasks WHERE id = $1",
                        item_id
                    )
                elif item_name:
                    row = await db.pool.fetchrow(
                        "SELECT id, title, status, priority, goal_id, description, content FROM tasks WHERE title ILIKE $1 LIMIT 1",
                        f"%{item_name}%"
                    )

                if row:
                    content = row["content"]
                    if isinstance(content, str):
                        content = json.loads(content) if content else []
                    result = {
                        "action": "open_detail",
                        "type": "task",
                        "data": {
                            "id": str(row["id"]),
                            "title": row["title"],
                            "status": row["status"],
                            "priority": row["priority"],
                            "goal_id": str(row["goal_id"]) if row["goal_id"] else None,
                            "description": row["description"],
                            "content": content or []
                        }
                    }
                    return {"success": True, "result": result}

            return {"success": False, "error": f"找不到匹配的{item_type}: {item_name or item_id}"}

        elif tool_name == "call_autumnrice":
            # Call Autumnrice (秋米) - dual mode: chain or queue
            # - chain: 即时执行，同步返回（适合 NOW 场景）
            # - queue: 任务入库，异步执行（适合 TONIGHT 场景，默认）
            task_desc = args.get("task", "")
            mode = args.get("mode", "queue")  # "chain" or "queue"
            priority = args.get("priority", "P1")
            project = args.get("project")

            if not task_desc:
                return {"success": False, "error": "task is required"}

            if mode not in ("chain", "queue"):
                return {"success": False, "error": "mode must be 'chain' or 'queue'"}

            # ============== MODE: CHAIN ==============
            # Agent Chain - 即时执行，同步返回
            if mode == "chain":
                # Build the autumnrice prompt
                prompt = f"/autumnrice {task_desc}"
                if priority:
                    prompt += f" --priority {priority}"
                if project:
                    prompt += f" --project {project}"

                # Run Autumnrice (headless Claude Code with Opus model)
                claude_path = HOME / ".local" / "bin" / "claude"
                try:
                    result = subprocess.run(
                        [
                            str(claude_path), "-p", prompt,
                            "--model", "opus",
                            "--output-format", "json",
                            "--allowed-tools", "Bash"
                        ],
                        capture_output=True,
                        text=True,
                        timeout=300,  # 5 minutes for chain mode
                        cwd=str(HOME / "dev" / "cecelia-semantic-brain")
                    )

                    if result.returncode == 0:
                        try:
                            output = json.loads(result.stdout)
                            return {
                                "success": True,
                                "result": {
                                    "action": "chain_executed",
                                    "mode": "chain",
                                    "task": task_desc,
                                    "output": output
                                }
                            }
                        except json.JSONDecodeError:
                            return {
                                "success": True,
                                "result": {
                                    "action": "chain_executed",
                                    "mode": "chain",
                                    "task": task_desc,
                                    "output": result.stdout[:2000]
                                }
                            }
                    else:
                        return {
                            "success": False,
                            "error": f"Chain mode failed: {result.stderr[:500]}"
                        }
                except subprocess.TimeoutExpired:
                    return {
                        "success": False,
                        "error": "Chain mode timeout (300s)"
                    }
                except Exception as e:
                    return {"success": False, "error": f"Chain mode error: {e}"}

            # ============== MODE: QUEUE ==============
            # Task Queue - 任务入库，异步执行
            try:
                # Get database from v2 routes
                db = orchestrator_v2.get_db()

                # Generate idempotency_key from task description hash
                idempotency_key = hashlib.sha256(task_desc.encode()).hexdigest()[:16]

                # Check for existing TRD with same idempotency_key
                existing = await db.fetchrow(
                    "SELECT * FROM trds WHERE idempotency_key = $1",
                    idempotency_key
                )
                if existing:
                    # Return existing TRD
                    trd = orchestrator_v2._row_to_trd(existing)
                    tasks_rows = await db.fetch(
                        "SELECT * FROM orchestrator_tasks WHERE trd_id = $1",
                        trd.id
                    )
                    tasks = [orchestrator_v2._row_to_task(row) for row in tasks_rows]
                    return {
                        "success": True,
                        "result": {
                            "action": "trd_exists",
                            "mode": "queue",
                            "message": "TRD already exists with same task",
                            "trd_id": trd.id,
                            "trd_title": trd.title,
                            "trd_status": trd.status.value,
                            "tasks_count": len(tasks),
                            "tasks": [
                                {"id": t.id, "title": t.title, "status": t.status.value}
                                for t in tasks
                            ]
                        }
                    }

                # Create new TRD
                trd = TRD(
                    title=task_desc[:100],  # Truncate title
                    description=task_desc,
                    projects=[project] if project else [],
                    acceptance_criteria=[],
                )
                await orchestrator_v2._save_trd(db, trd, idempotency_key=idempotency_key)

                # Call planner to decompose into tasks
                planner = Planner()
                context = {
                    "priority": priority,
                    "projects": [project] if project else [],
                }
                plan_result = planner.plan(trd, context)

                if not plan_result.success:
                    return {
                        "success": True,
                        "result": {
                            "action": "trd_created",
                            "mode": "queue",
                            "trd_id": trd.id,
                            "trd_title": trd.title,
                            "trd_status": trd.status.value,
                            "planning_error": plan_result.error,
                            "tasks_count": 0,
                            "tasks": []
                        }
                    }

                # Validate and save tasks
                errors = planner.validate_tasks(plan_result.tasks)
                if errors:
                    return {
                        "success": True,
                        "result": {
                            "action": "trd_created",
                            "mode": "queue",
                            "trd_id": trd.id,
                            "trd_title": trd.title,
                            "trd_status": trd.status.value,
                            "validation_errors": errors,
                            "tasks_count": 0,
                            "tasks": []
                        }
                    }

                # Update TRD and tasks via state machine
                state_machine = StateMachine()
                try:
                    trd, tasks = state_machine.plan_trd(trd, plan_result.tasks)
                except StateTransitionError as e:
                    return {
                        "success": True,
                        "result": {
                            "action": "trd_created",
                            "mode": "queue",
                            "trd_id": trd.id,
                            "trd_title": trd.title,
                            "trd_status": trd.status.value,
                            "state_error": str(e),
                            "tasks_count": 0,
                            "tasks": []
                        }
                    }

                # Save to DB
                await orchestrator_v2._save_trd(db, trd)
                for task in tasks:
                    await orchestrator_v2._save_task(db, task)

                return {
                    "success": True,
                    "result": {
                        "action": "trd_created_and_planned",
                        "mode": "queue",
                        "trd_id": trd.id,
                        "trd_title": trd.title,
                        "trd_status": trd.status.value,
                        "tasks_count": len(tasks),
                        "tasks": [
                            {
                                "id": t.id,
                                "title": t.title,
                                "status": t.status.value,
                                "priority": t.priority
                            }
                            for t in tasks
                        ],
                        "next_step": "Tasks queued. Call /tick or wait for N8N."
                    }
                }

            except Exception as e:
                return {"success": False, "error": f"Queue mode error: {e}"}

        else:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        print(f"[Tool] Error executing {tool_name}: {e}")
        return {"success": False, "error": str(e)}
