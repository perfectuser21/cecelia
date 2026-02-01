"""Orchestrator API routes for Cecelia Semantic Brain.

Exposes ~/runtime/state.json, chat API, voice API, and realtime WebSocket to the frontend.
"""

import asyncio
import base64
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
            "instructions": """You are Cecelia (塞西莉亚), the AI assistant for managing your work.

CECELIA ORGAN SYSTEM:
- Mouth (你) = 接收语音/文本输入
- Brain = 决策与规划中心 (Node Brain)
- Hands = 执行代码 (Claude Code)
- Memory = 语义搜索
- Intelligence = 监控与分析

AVAILABLE TOOLS:
- get_okrs, get_projects, get_tasks = 查询数据
- open_detail = 打开详情面板
- navigate_to_page = 页面导航
- get_queue = 查看任务队列
- execute_now = 插队执行任务
- pause_task = 暂停正在执行的任务

WHEN TO USE WHICH TOOL:
- "有哪些任务/OKR/项目" → get_tasks/get_okrs/get_projects
- "打开/显示/看看 XXX" → open_detail
- "去XXX页面" → navigate_to_page
- "队列里有什么" → get_queue
- "让XXX插队" → execute_now
- "暂停XXX任务" → pause_task

Examples:
- "看看Brain MVP" → open_detail(type="okr", name="Brain MVP")
- "队列里有什么" → get_queue()
- "让登录功能插队" → execute_now(task_name="登录功能")

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
                    "name": "navigate_to_page",
                    "description": "导航到指定页面。当用户说 '去/打开/跳转到 XXX页面' 时使用此工具，而不是 open_detail。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "page": {
                                "type": "string",
                                "enum": ["okr", "projects", "tasks", "orchestrator", "planner", "brain", "home"],
                                "description": "目标页面名称"
                            }
                        },
                        "required": ["page"]
                    }
                },
                {
                    "type": "function",
                    "name": "get_queue",
                    "description": "查看当前任务队列状态（排队中和执行中的任务）",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                },
                {
                    "type": "function",
                    "name": "execute_now",
                    "description": "让某个任务插队，立即执行（如果有空闲槽位）",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_name": {
                                "type": "string",
                                "description": "任务名称（模糊匹配）"
                            }
                        },
                        "required": ["task_name"]
                    }
                },
                {
                    "type": "function",
                    "name": "pause_task",
                    "description": "暂停正在执行的任务，释放执行槽位",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_name": {
                                "type": "string",
                                "description": "任务名称（模糊匹配）"
                            }
                        },
                        "required": ["task_name"]
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
            extra_headers=headers,
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

        elif tool_name == "navigate_to_page":
            # Navigate to a page - return action for frontend to handle
            page = args.get("page")
            if not page:
                return {"success": False, "error": "page is required"}

            page_routes = {
                "okr": "/okr",
                "projects": "/projects",
                "tasks": "/tasks",
                "orchestrator": "/orchestrator",
                "planner": "/planner",
                "brain": "/brain",
                "home": "/",
            }

            if page not in page_routes:
                return {"success": False, "error": f"Unknown page: {page}"}

            return {
                "success": True,
                "result": {
                    "action": "navigate",
                    "page": page,
                    "path": page_routes[page]
                }
            }

        elif tool_name == "get_queue":
            # Get current queue status from Core API
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get("http://localhost:5211/api/orchestrator/queue")
                    data = response.json()

                if not data.get("success"):
                    return {"success": False, "error": data.get("error", "Failed to get queue")}

                queue_data = data.get("data", {})
                running = queue_data.get("running", [])
                queued = queue_data.get("queued", [])
                stats = queue_data.get("stats", {})

                # Format summary for voice response
                summary = {
                    "running_count": stats.get("running_count", 0),
                    "queued_count": stats.get("queued_count", 0),
                    "available_slots": stats.get("available_slots", 0),
                    "running_tasks": [{"title": t.get("title", ""), "progress": t.get("progress", 0)} for t in running[:3]],
                    "queued_tasks": [{"position": i + 1, "title": t.get("title", "")} for i, t in enumerate(queued[:5])]
                }

                return {"success": True, "result": summary}
            except Exception as e:
                return {"success": False, "error": f"Failed to fetch queue: {e}"}

        elif tool_name == "execute_now":
            # Execute task now (fuzzy match + call Core API)
            task_name = args.get("task_name")
            if not task_name:
                return {"success": False, "error": "task_name is required"}

            try:
                # Get queue to find task
                async with httpx.AsyncClient() as client:
                    queue_response = await client.get("http://localhost:5211/api/orchestrator/queue")
                    queue_data = queue_response.json()

                if not queue_data.get("success"):
                    return {"success": False, "error": "Failed to get queue"}

                # Fuzzy match task name
                queued = queue_data.get("data", {}).get("queued", [])
                task = next((t for t in queued if task_name.lower() in t.get("title", "").lower()), None)

                if not task:
                    return {"success": False, "error": f"没有找到任务：{task_name}"}

                # Call execute-now API
                async with httpx.AsyncClient() as client:
                    exec_response = await client.post(f"http://localhost:5211/api/orchestrator/execute-now/{task['id']}")
                    exec_data = exec_response.json()

                if not exec_data.get("success"):
                    return {"success": False, "error": exec_data.get("error", "Failed to execute")}

                return {"success": True, "result": exec_data.get("data", {})}
            except Exception as e:
                return {"success": False, "error": f"Failed to execute task: {e}"}

        elif tool_name == "pause_task":
            # Pause running task (fuzzy match + call Core API)
            task_name = args.get("task_name")
            if not task_name:
                return {"success": False, "error": "task_name is required"}

            try:
                # Get queue to find running task
                async with httpx.AsyncClient() as client:
                    queue_response = await client.get("http://localhost:5211/api/orchestrator/queue")
                    queue_data = queue_response.json()

                if not queue_data.get("success"):
                    return {"success": False, "error": "Failed to get queue"}

                # Fuzzy match task name
                running = queue_data.get("data", {}).get("running", [])
                task = next((t for t in running if task_name.lower() in t.get("title", "").lower()), None)

                if not task:
                    return {"success": False, "error": f"没有找到运行中的任务：{task_name}"}

                # Call pause API
                async with httpx.AsyncClient() as client:
                    pause_response = await client.post(f"http://localhost:5211/api/orchestrator/pause/{task['id']}")
                    pause_data = pause_response.json()

                if not pause_data.get("success"):
                    return {"success": False, "error": pause_data.get("error", "Failed to pause")}

                return {"success": True, "result": pause_data.get("data", {})}
            except Exception as e:
                return {"success": False, "error": f"Failed to pause task: {e}"}

        else:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        print(f"[Tool] Error executing {tool_name}: {e}")
        return {"success": False, "error": str(e)}
