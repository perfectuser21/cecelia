#!/usr/bin/env bash
# ============================================================================
# Stop Hook for conversation mode (v2.0.0)
# ============================================================================
# 触发条件：项目根目录存在 .conversation-mode 文件
#
# 对账逻辑（design⑧a + PR4/4 D3 补强）：
#   1. 读 transcript JSONL，提取最后一个 [TURN:...] 标记
#   2. [TURN: decision_saved=<uuid>]：curl 对账，未落库 → exit 2
#   3. [TURN: pending_user]（PR4 D3 新增）：等待用户确认 → exit 2
#   4. 无任何 [TURN:...] 标记（PR4 D3 新增）：防止 agent 静默退出 → exit 2
#   5. [TURN: chat] / decision 已落库 → exit 0（放行）
#
# 不判语义，只验协议 + 对账（仿 dc18d43d 收账权收归哲学）。
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOCK_FILE="$PROJECT_ROOT/.conversation-mode"

# 不在对话模式中，直接放行
if [[ ! -f "$LOCK_FILE" ]]; then
    exit 0
fi

TRANSCRIPT="${CLAUDE_HOOK_TRANSCRIPT_PATH:-}"
if [[ -z "$TRANSCRIPT" ]] || [[ ! -f "$TRANSCRIPT" ]]; then
    exit 0
fi

echo "=== /conversation Stop Hook v2: 协议对账 ==="

# ── 从 transcript JSONL 提取最后一个 [TURN:...] 标记和 decision_saved UUID ──
# transcript 格式：每行一个 JSON 对象，assistant 消息在 message.content 或 content 字段
# 输出格式：<turn_type> <uuid_or_empty>
# turn_type: "decision_saved" | "pending_user" | "chat" | "none"
TURN_INFO=$(python3 - "$TRANSCRIPT" <<'PYEOF'
import sys, json, re

path = sys.argv[1]
turn_re = re.compile(r'\[TURN:\s*([^\]]+)\]')
decision_re = re.compile(r'decision_saved=([0-9a-fA-F-]{36})')

last_turn_type = 'none'
last_uuid = ''

try:
    with open(path, 'r', errors='replace') as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
                # 从多种 transcript 字段格式取 assistant 内容
                content_str = ''
                msg = obj.get('message') or obj
                role = (obj.get('role') or obj.get('message', {}).get('role', ''))
                content = msg.get('content', '')
                if isinstance(content, str):
                    content_str = content
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get('type') == 'text':
                            content_str += block.get('text', '')
                m = turn_re.search(content_str)
                if m:
                    turn_body = m.group(1).strip()
                    dm = decision_re.search(turn_body)
                    if dm:
                        last_turn_type = 'decision_saved'
                        last_uuid = dm.group(1)
                    elif 'pending_user' in turn_body:
                        last_turn_type = 'pending_user'
                        last_uuid = ''
                    else:
                        last_turn_type = 'chat'
                        last_uuid = ''
            except Exception:
                continue
except Exception:
    pass

print(last_turn_type + ' ' + last_uuid)
PYEOF
)

TURN_TYPE="${TURN_INFO%% *}"
DECISION_UUID="${TURN_INFO#* }"
# 去除前后空白
TURN_TYPE="${TURN_TYPE//[[:space:]]/}"
DECISION_UUID="${DECISION_UUID//[[:space:]]/}"

# ── 分支路由 ─────────────────────────────────────────────────────────────────

if [[ "$TURN_TYPE" == "none" ]]; then
    # PR4 D3：.conversation-mode 存在但末轮无任何 [TURN:...] → 阻断（防止 agent 静默退出）
    echo "  ✗ .conversation-mode 存在，但末轮无任何 [TURN:...] 协议标记"
    echo "  → 阻止退出：agent 必须在每轮末尾打 [TURN: chat|decision_saved=<uuid>|pending_user]"
    exit 2
fi

if [[ "$TURN_TYPE" == "pending_user" ]]; then
    # PR4 D3：pending_user → 等待用户确认，阻断退出
    echo "  等待用户确认（pending_user）"
    echo "  → 阻止退出：agent 已抛出问题/选项，等用户拍板后方可结束会话"
    exit 2
fi

if [[ "$TURN_TYPE" == "chat" ]]; then
    echo "  → 末轮为纯聊天 [TURN: chat]，放行"
    exit 0
fi

# TURN_TYPE == "decision_saved"
if [[ -z "$DECISION_UUID" ]]; then
    echo "  ✗ 检测到 decision_saved 但 UUID 为空，阻止退出"
    exit 2
fi

echo "  → 检测到 decision_saved=${DECISION_UUID}，开始验证…"

# ── curl 对账 ────────────────────────────────────────────────────────────────
HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    --connect-timeout 4 --max-time 8 \
    "http://localhost:5221/api/brain/decisions/${DECISION_UUID}" 2>/dev/null \
    || echo '000')

if [[ "$HTTP_STATUS" == "200" ]]; then
    echo "  ✓ decision ${DECISION_UUID} 已确认落库，放行"
    exit 0
else
    echo "  ✗ decision ${DECISION_UUID} 未找到（HTTP ${HTTP_STATUS}）"
    echo "  → 阻止退出：请先将决策真实写入 decisions 表后再结束会话"
    exit 2
fi
