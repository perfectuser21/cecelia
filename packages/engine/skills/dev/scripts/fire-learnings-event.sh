#!/usr/bin/env bash
# fire-learnings-event.sh — 触发 LEARNINGS_RECEIVED 事件到 Brain
#
# 正确路径：LEARNINGS.md → POST /api/brain/learnings-received
#   → 丘脑分拣（有 bug → fix task；有经验 → learnings 表 → 反刍 → NotebookLM）
#
# 用法：
#   bash fire-learnings-event.sh [--test]
#   bash fire-learnings-event.sh --branch cp-xxx --pr 123 --task-id abc

set -euo pipefail

# ── 配置 ─────────────────────────────────────────────────────────────
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
LEARNINGS_FILE="${LEARNINGS_FILE:-docs/LEARNINGS.md}"
INCIDENT_FILE="${INCIDENT_FILE:-.dev-incident-log.json}"

# 参数解析
BRANCH_NAME=""
PR_NUMBER=""
TASK_ID=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH_NAME="$2"; shift 2 ;;
    --pr) PR_NUMBER="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) shift ;;
  esac
done

# 从 .dev-mode 自动读取（如果未传参）
if [[ -z "$BRANCH_NAME" && -f ".dev-mode" ]]; then
  BRANCH_NAME=$(grep "^branch:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")
fi
if [[ -z "$TASK_ID" && -f ".dev-mode" ]]; then
  TASK_ID=$(grep "^task_id:" .dev-mode 2>/dev/null | cut -d' ' -f2 || echo "")
fi

# ── 提取 issues_found（来自 incident log，已有 bug/失败记录）─────────
extract_issues() {
  if [[ -f "$INCIDENT_FILE" ]]; then
    local count
    count=$(jq 'length' "$INCIDENT_FILE" 2>/dev/null || echo "0")
    if [[ "$count" -gt 0 ]]; then
      # 提取 ci_failure 和 test_failure 类型的失败记录
      jq -r '[.[] | select(.type == "ci_failure" or .type == "test_failure") |
        "[" + .step + "] " + .description +
        (if .resolution != "" then " → 修复: " + .resolution else "" end)]' \
        "$INCIDENT_FILE" 2>/dev/null || echo "[]"
      return
    fi
  fi
  echo "[]"
}

# ── 提取 next_steps_suggested（来自 LEARNINGS.md 最后一节的预防措施）─
extract_next_steps() {
  if [[ ! -f "$LEARNINGS_FILE" ]]; then
    echo "[]"
    return
  fi

  # 提取最后一个 ### 节的**预防措施**内容
  local raw
  raw=$(awk '/^### /{found=1; content=""} found{content=content"\n"$0} END{print content}' "$LEARNINGS_FILE" 2>/dev/null || echo "")

  if [[ -z "$raw" ]]; then
    echo "[]"
    return
  fi

  # 提取预防措施列表项（**预防措施**下面的 - 开头行）
  echo "$raw" | awk '
    /\*\*预防措施\*\*|**预防措施**/ { in_section=1; next }
    in_section && /^- / { print substr($0, 3) }
    in_section && /^\*\*/ && !/预防措施/ { in_section=0 }
  ' | jq -R . | jq -s . 2>/dev/null || echo "[]"
}

# ── 构建 payload ──────────────────────────────────────────────────────
ISSUES=$(extract_issues)
NEXT_STEPS=$(extract_next_steps)

ISSUES_COUNT=$(echo "$ISSUES" | jq 'length' 2>/dev/null || echo "0")
STEPS_COUNT=$(echo "$NEXT_STEPS" | jq 'length' 2>/dev/null || echo "0")

echo "📚 LEARNINGS_RECEIVED 事件准备："
echo "  issues_found: ${ISSUES_COUNT} 条（来自 incident log）"
echo "  next_steps_suggested: ${STEPS_COUNT} 条（来自 LEARNINGS.md 预防措施）"

if [[ "$ISSUES_COUNT" -eq 0 && "$STEPS_COUNT" -eq 0 ]]; then
  echo "  ℹ️  无内容，跳过发送"
  exit 0
fi

PAYLOAD=$(jq -n \
  --argjson issues "$ISSUES" \
  --argjson steps "$NEXT_STEPS" \
  --arg branch "$BRANCH_NAME" \
  --arg pr "$PR_NUMBER" \
  --arg task_id "$TASK_ID" \
  '{
    issues_found: $issues,
    next_steps_suggested: $steps,
    branch_name: $branch,
    pr_number: ($pr | if . == "" then null else . end),
    task_id: ($task_id | if . == "" then null else . end)
  }')

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "=== DRY RUN payload ==="
  echo "$PAYLOAD" | jq .
  echo "========================"
  exit 0
fi

# ── POST 到 Brain ─────────────────────────────────────────────────────
ENDPOINT="${BRAIN_URL}/api/brain/learnings-received"

echo "📤 发送到 Brain: $ENDPOINT"

RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 15 2>/dev/null || echo '{"success":false,"error":"curl failed"}')

SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false' 2>/dev/null || echo "false")
TASKS=$(echo "$RESPONSE" | jq -r '.tasks_created // 0' 2>/dev/null || echo "0")
LEARNINGS=$(echo "$RESPONSE" | jq -r '.learnings_inserted // 0' 2>/dev/null || echo "0")

if [[ "$SUCCESS" == "true" ]]; then
  echo "✅ LEARNINGS_RECEIVED 发送成功："
  echo "   → ${TASKS} 个 fix task 创建（任务线）"
  echo "   → ${LEARNINGS} 条 learning 写入（成长线 → 反刍 → NotebookLM）"
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "unknown"' 2>/dev/null || echo "unknown")
  echo "⚠️  LEARNINGS_RECEIVED 发送失败（Brain 不可用，不阻塞流程）: $ERROR"
fi
