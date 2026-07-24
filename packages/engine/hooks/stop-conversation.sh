#!/usr/bin/env bash
# ============================================================================
# Stop Hook for conversation mode (v1.0.0)
# ============================================================================
# 触发条件：项目根目录存在 .conversation-mode 文件
#
# 对账逻辑（design⑧a）：
#   1. 读 transcript JSONL，提取最后一个含 [TURN:decision_saved=<uuid>] 的 assistant 回复
#   2. 若存在，curl GET /api/brain/decisions/:uuid 验证 UUID 真实落库
#   3. 未找到 → exit 2（阻止退出，强制 Claude 补落库重试）
#   4. 找到 / 无标记 → exit 0（放行）
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

echo "=== /conversation Stop Hook: 协议对账 ==="

# ── 从 transcript JSONL 提取最后一个 decision_saved UUID ──────────────────────
# transcript 格式：每行一个 JSON 对象，assistant 消息在 message.content 或 content 字段
DECISION_UUID=$(python3 - "$TRANSCRIPT" <<'PYEOF'
import sys, json, re

path = sys.argv[1]
pattern = re.compile(r'\[TURN:\s*decision_saved=([0-9a-fA-F-]{36})\]')
last_uuid = None

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
                if role not in ('assistant', ''):
                    pass
                content = msg.get('content', '')
                if isinstance(content, str):
                    content_str = content
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get('type') == 'text':
                            content_str += block.get('text', '')
                m = pattern.search(content_str)
                if m:
                    last_uuid = m.group(1)
            except Exception:
                continue
except Exception:
    pass

print(last_uuid or '')
PYEOF
)

if [[ -z "$DECISION_UUID" ]]; then
    echo "  → 末轮无 decision_saved 标记，放行"
    exit 0
fi

echo "  → 检测到 decision_saved=$DECISION_UUID，开始验证…"

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
