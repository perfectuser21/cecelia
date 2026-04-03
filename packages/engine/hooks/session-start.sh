#!/usr/bin/env bash
# =============================================================================
# session-start.sh — UserPromptSubmit Hook
# 在每次对话第一条消息时，自动注入 Brain 当前状态（活跃任务摘要）
#
# 工作原理：
# - 使用 PPID + Claude 配置目录哈希作为 session 标识（避免多会话冲突）
# - 首条消息 → 查询 Brain API → 输出 additionalContext → 创建 session 标记
# - 后续消息 → 检测到标记 → 静默退出
# - Brain 离线 → 静默退出（exit 0），不阻塞对话
# =============================================================================

set -euo pipefail

BRAIN_URL="http://localhost:5221"
# P1 修复：PPID + Claude 配置目录哈希，避免多会话/多账号 PPID 冲突
_SESSION_EXTRA=$(printf '%s' "${CLAUDE_CONFIG_DIR:-default}" | shasum 2>/dev/null | cut -c1-8 || echo "0")
SESSION_MARKER="/tmp/.cecelia-session-${PPID}-${_SESSION_EXTRA}.injected"

# 已经注入过 → 静默退出
if [[ -f "$SESSION_MARKER" ]]; then
    exit 0
fi

# 标记本次 session（无论 Brain 是否在线，防止重复注入）
touch "$SESSION_MARKER"

# 查询活跃任务（Brain 离线则静默退出）
TASKS_JSON=$(curl -s --max-time 2 "${BRAIN_URL}/api/brain/tasks?status=in_progress&limit=5" 2>/dev/null || echo "[]")
QUEUED_JSON=$(curl -s --max-time 2 "${BRAIN_URL}/api/brain/tasks?status=queued&task_type=dev&limit=3" 2>/dev/null || echo "[]")

# 检查是否获取到有效数据
TASK_COUNT=$(echo "$TASKS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")

if [[ "$TASK_COUNT" == "0" && "$TASKS_JSON" == "[]" ]]; then
    # Brain 离线或无数据，静默退出
    exit 0
fi

# 格式化任务列表
TASK_LINES=$(echo "$TASKS_JSON" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
lines = []
for t in tasks[:5]:
    title = t.get('title', '?')[:50]
    task_type = t.get('task_type', '?')
    priority = t.get('priority', '')
    lines.append(f'  [{priority}] {title} ({task_type})')
print('\n'.join(lines))
" 2>/dev/null || echo "  (解析失败)")

QUEUED_LINES=$(echo "$QUEUED_JSON" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
lines = []
for t in tasks[:3]:
    title = t.get('title', '?')[:50]
    priority = t.get('priority', '')
    lines.append(f'  [{priority}] {title}')
print('\n'.join(lines))
" 2>/dev/null || echo "")

# 构建注入内容
CONTEXT="## Brain 当前状态（自动注入）

**进行中任务**：
${TASK_LINES}"

if [[ -n "$QUEUED_LINES" && "$QUEUED_LINES" != "  " ]]; then
    CONTEXT="${CONTEXT}

**排队中 dev 任务**：
${QUEUED_LINES}"
fi

CONTEXT="${CONTEXT}

> 查完整状态：curl 'localhost:5221/api/brain/tasks?status=in_progress&limit=10'"

# ─── 追加 CURRENT_STATE.md 系统健康状态 ──────────────────────────────────────
# 找到主仓库路径（兼容 worktree 和主仓库两种情况）
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
if [[ "$GIT_COMMON" == ".git" ]]; then
    _MAIN_REPO=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
else
    _MAIN_REPO=$(dirname "$GIT_COMMON")
fi
CURRENT_STATE_FILE="${_MAIN_REPO}/.agent-knowledge/CURRENT_STATE.md"

if [[ -f "$CURRENT_STATE_FILE" ]]; then
    # 读取 probe 摘要行（第一个 > 行包含探针结果统计）
    PROBE_SUMMARY=$(grep "^> 最后探针时间" "$CURRENT_STATE_FILE" 2>/dev/null | head -1 || echo "")
    HEALTH_LINE=$(grep "| Brain API |" "$CURRENT_STATE_FILE" 2>/dev/null | head -1 | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}' || echo "")
    ALERTNESS_LINE=$(grep "| 警觉等级 |" "$CURRENT_STATE_FILE" 2>/dev/null | head -1 | awk -F'|' '{print $3}' | tr -d ' ' || echo "")
    GEN_TIME=$(grep "^generated:" "$CURRENT_STATE_FILE" 2>/dev/null | head -1 | sed 's/generated: //' || echo "")

    if [[ -n "$PROBE_SUMMARY" || -n "$HEALTH_LINE" ]]; then
        CONTEXT="${CONTEXT}

## 系统健康（CURRENT_STATE.md）

Brain: ${HEALTH_LINE:-?} | 警觉: ${ALERTNESS_LINE:-?}
${PROBE_SUMMARY:+Probe: ${PROBE_SUMMARY}}
更新于: ${GEN_TIME:-未知}"
    fi
fi

# 输出 JSON 格式（additionalContext 注入到 Claude context）
python3 -c "
import json, sys
context = sys.stdin.read()
output = {
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': context
    }
}
print(json.dumps(output))
" <<< "$CONTEXT"
