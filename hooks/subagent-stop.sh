#!/usr/bin/env bash
# ============================================================================
# SubagentStop Hook: 子 Agent 循环控制器（JSON API 实现）
# ============================================================================
# 检测子 agent（Explore, Plan 等）是否应该继续执行：
#
# - 无 .dev-mode → exit 0（允许结束）
# - 有 .dev-mode → 检查 Subagent 重试次数：
#   - < 5 次 → JSON API + exit 0（强制继续）
#   - >= 5 次 → exit 0（允许 Subagent 结束，主 Agent 换方案）
#
# v11.25.0: H7-009 - 新增 SubagentStop Hook，5 次重试上限
# ============================================================================

set -euo pipefail

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== 检查 .dev-mode 文件 =====
DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"

if [[ ! -f "$DEV_MODE_FILE" ]]; then
    # 普通会话，没有 .dev-mode，直接允许结束
    exit 0
fi

# ===== 读取 Hook 输入（JSON） =====
HOOK_INPUT=$(cat)

# 提取 agent_type（如果存在）
AGENT_TYPE=$(echo "$HOOK_INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null || echo "unknown")

# ===== 检查 Subagent 重试次数（5 次上限）=====
SUBAGENT_RETRY_COUNT=$(grep "^subagent_retry_count:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "0")
SUBAGENT_RETRY_COUNT=${SUBAGENT_RETRY_COUNT//[^0-9]/}  # 清理非数字字符
SUBAGENT_RETRY_COUNT=${SUBAGENT_RETRY_COUNT:-0}        # 空值默认为 0

if [[ $SUBAGENT_RETRY_COUNT -ge 5 ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [SubagentStop Hook: 5 次重试上限]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  Subagent ($AGENT_TYPE) 已重试 5 次" >&2
    echo "  允许 Subagent 退出，主 Agent 将尝试其他方案" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0  # 允许 Subagent 结束
fi

# 更新 Subagent 重试次数
sed -i "/^subagent_retry_count:/d" "$DEV_MODE_FILE" 2>/dev/null || true
echo "subagent_retry_count: $((SUBAGENT_RETRY_COUNT + 1))" >> "$DEV_MODE_FILE"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [SubagentStop Hook: 强制继续]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  Agent 类型: $AGENT_TYPE" >&2
echo "  重试次数: $((SUBAGENT_RETRY_COUNT + 1))/5" >&2
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

# 使用 JSON API 强制 Subagent 继续执行
jq -n --arg reason "Subagent ($AGENT_TYPE) 尚未完成任务，继续执行（重试 $((SUBAGENT_RETRY_COUNT + 1))/5）" '{"decision": "block", "reason": $reason}'
exit 0
