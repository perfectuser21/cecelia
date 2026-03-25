#!/usr/bin/env bash
# =============================================================================
# session-start.sh — UserPromptSubmit Hook
# 在每次对话第一条消息时，自动注入 Brain 当前状态（活跃任务摘要）
#
# 工作原理：
# - 使用 PPID（Claude Code 进程 PID）作为 session 标识
# - 首条消息 → 查询 Brain API → 输出 additionalContext → 创建 session 标记
# - 后续消息 → 检测到标记 → 静默退出
# - Brain 离线 → 静默退出（exit 0），不阻塞对话
# =============================================================================

set -euo pipefail

BRAIN_URL="http://localhost:5221"
SESSION_MARKER="/tmp/.cecelia-session-${PPID}.injected"

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
