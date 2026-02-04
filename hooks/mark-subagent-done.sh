#!/usr/bin/env bash
# PostToolUse[Task] hook: 当 gate subagent 返回 PASS 时，写令牌到 .git/.gate_tokens/
# 令牌绑定 session_id + nonce，一次性使用

set -euo pipefail

# 只处理 Task tool
TOOL_NAME="${TOOL_NAME:-}"
if [[ "$TOOL_NAME" != "Task" ]]; then
    exit 0
fi

# 从 stdin 读取 tool_result
TOOL_INPUT=$(cat)

# 检查 description 是否是 gate 类型
DESCRIPTION=$(printf '%s' "$TOOL_INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null || echo "")
if [[ -z "$DESCRIPTION" ]]; then
    exit 0
fi

# 匹配 gate 类型: gate:prd, gate:dod, gate:test, gate:audit, gate:qa
if [[ ! "$DESCRIPTION" =~ ^gate:(prd|dod|test|audit|qa)$ ]]; then
    exit 0
fi

GATE_TYPE="${BASH_REMATCH[1]}"

# 从 tool_result 中检查是否包含 "Decision: PASS"
TOOL_RESULT=$(printf '%s' "$TOOL_INPUT" | jq -r '.tool_result // ""' 2>/dev/null || echo "")
if [[ -z "$TOOL_RESULT" ]]; then
    exit 0
fi

if ! printf '%s' "$TOOL_RESULT" | grep -qE 'Decision:'; then
    echo "[WARN] gate:$GATE_TYPE subagent 返回结果中无 Decision 字段，可能是 schema 不匹配" >&2
    exit 0
fi

if ! printf '%s' "$TOOL_RESULT" | grep -qE 'Decision:\s*\*{0,2}PASS\*{0,2}'; then
    echo "[INFO] gate:$GATE_TYPE subagent 返回 Decision 非 PASS，令牌不生成" >&2
    exit 0
fi

# 获取 session_id
SESSION_ID=""
if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
    SESSION_ID="$CLAUDE_SESSION_ID"
elif [[ -f ".dev-mode" ]]; then
    SESSION_ID=$(grep '^session_id:' .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")
fi
if [[ -z "$SESSION_ID" ]]; then
    SESSION_ID="default"
fi

# 生成 nonce
NONCE=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')

# 写令牌
TOKEN_DIR=".git/.gate_tokens"
# Bug fix: mkdir 错误处理，确保目录创建成功
if ! mkdir -p "$TOKEN_DIR" 2>/dev/null; then
    echo "[ERROR] 无法创建令牌目录: $TOKEN_DIR" >&2
    # 检查是否是因为存在同名文件
    if [[ -f "$TOKEN_DIR" ]]; then
        echo "[ERROR] $TOKEN_DIR 是一个文件，不是目录" >&2
    fi
    exit 1
fi
TOKEN_FILE="$TOKEN_DIR/subagent-${GATE_TYPE}-${SESSION_ID}.token"

cat > "$TOKEN_FILE" << EOF
gate: $GATE_TYPE
session_id: $SESSION_ID
nonce: $NONCE
created: $(date -Iseconds)
EOF

echo "🔑 Gate 令牌已生成: $GATE_TYPE (session: $SESSION_ID)" >&2
exit 0
