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
# Per-branch learning 文件：优先 docs/learnings/<branch>.md，兜底 docs/LEARNINGS.md
LEARNINGS_FILE="${LEARNINGS_FILE:-}"

# 参数解析
BRANCH_NAME=""
PR_NUMBER=""
TASK_ID=""
REPO="${REPO:-cecelia}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH_NAME="$2"; shift 2 ;;
    --pr) PR_NUMBER="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) shift ;;
  esac
done

# 从 .dev-mode.{branch} 自动读取（v5.0.0 per-branch 格式）
if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
if [[ ! -f "$DEV_MODE_FILE" ]]; then
  DEV_MODE_FILE=".dev-mode"
fi
if [[ -z "$BRANCH_NAME" && -f "$DEV_MODE_FILE" ]]; then
  BRANCH_NAME=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")
fi
if [[ -z "$TASK_ID" && -f "$DEV_MODE_FILE" ]]; then
  TASK_ID=$(grep "^task_id:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")
fi

# ── 自动检测 Learning 文件路径 ─────────────────────────────────────────
if [[ -z "$LEARNINGS_FILE" ]]; then
  # 优先 per-branch 文件
  if [[ -n "$BRANCH_NAME" && -f "docs/learnings/${BRANCH_NAME}.md" ]]; then
    LEARNINGS_FILE="docs/learnings/${BRANCH_NAME}.md"
  elif [[ -f "docs/LEARNINGS.md" ]]; then
    LEARNINGS_FILE="docs/LEARNINGS.md"
  else
    LEARNINGS_FILE="docs/LEARNINGS.md"
  fi
fi

# ── 提取 next_steps_suggested（来自 LEARNINGS.md 最后一节的预防措施）─
extract_next_steps() {
  if [[ ! -f "$LEARNINGS_FILE" ]]; then
    echo "[]"
    return
  fi

  # 直接全文搜索 ### 下次预防 节（不预先限制到"最后一节"）
  awk '
    /^### 下次预防/ { in_section=1; next }
    in_section && /^- / { print substr($0, 3) }
    in_section && /^### / { in_section=0 }
  ' "$LEARNINGS_FILE" 2>/dev/null | jq -R . | jq -s . 2>/dev/null || echo "[]"
}

# ── 构建 payload ──────────────────────────────────────────────────────
NEXT_STEPS=$(extract_next_steps)
STEPS_COUNT=$(echo "$NEXT_STEPS" | jq 'length' 2>/dev/null || echo "0")

echo "📚 LEARNINGS_RECEIVED 事件准备："
echo "  next_steps_suggested: ${STEPS_COUNT} 条（来自 Learning 预防措施）"

if [[ "$STEPS_COUNT" -eq 0 ]]; then
  echo "  ℹ️  无内容，跳过发送"
  exit 0
fi

PAYLOAD=$(jq -n \
  --argjson steps "$NEXT_STEPS" \
  --arg branch "$BRANCH_NAME" \
  --arg pr "$PR_NUMBER" \
  --arg task_id "$TASK_ID" \
  --arg repo "$REPO" \
  '{
    issues_found: [],
    next_steps_suggested: $steps,
    branch_name: $branch,
    pr_number: ($pr | if . == "" then null else . end),
    task_id: ($task_id | if . == "" then null else . end),
    repo: $repo
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
