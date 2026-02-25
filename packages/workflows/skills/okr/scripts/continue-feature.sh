#!/usr/bin/env bash
# OKR Feature Continuation Script (Strategy C: Iterative Refinement)
#
# 功能：基于 Task N 反馈，细化 Task N+1 或判断 Feature 完成
#
# Usage:
#   bash continue-feature.sh <feature-id> <task-n-feedback-file>
#
# Output (JSON):
#   {
#     "feedback_read": true,
#     "plan_adjusted": true,
#     "tasks_inserted": 0,
#     "next_task": {
#       "id": "task-002",
#       "title": "...",
#       "prd_status": "detailed",
#       "prd_content": "..."
#     },
#     "feature_completed": false
#   }
#
# 或（Feature 完成）:
#   {
#     "feedback_read": true,
#     "feature_completed": true,
#     "completion_reason": "所有计划 Tasks 已完成"
#   }

set -euo pipefail

# ===== Configuration =====
FEATURE_ID="${1:-}"
FEEDBACK_FILE="${2:-}"

# ===== Colors =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ===== Helper Functions =====

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}" >&2
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}" >&2
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}" >&2
}

log_error() {
    echo -e "${RED}❌ $1${NC}" >&2
}

# ===== Input Validation =====

if [ -z "$FEATURE_ID" ]; then
    log_error "Feature ID 不能为空"
    echo "Usage: $0 <feature-id> <feedback-file>"
    exit 1
fi

if [ -z "$FEEDBACK_FILE" ] || [ ! -f "$FEEDBACK_FILE" ]; then
    log_error "反馈文件不存在: $FEEDBACK_FILE"
    exit 1
fi

# ===== Read Feedback =====

log_info "读取 Task 反馈: $FEEDBACK_FILE"

# 解析反馈 JSON
FEEDBACK_SUMMARY=$(jq -r '.feedback.summary // "无总结"' "$FEEDBACK_FILE")
ISSUES_FOUND=$(jq -r '.feedback.issues_found // [] | join(", ")' "$FEEDBACK_FILE")
NEXT_STEPS=$(jq -r '.feedback.next_steps_suggested // [] | join(", ")' "$FEEDBACK_FILE")

log_info "反馈总结: $FEEDBACK_SUMMARY"
if [ -n "$ISSUES_FOUND" ] && [ "$ISSUES_FOUND" != "" ]; then
    log_warn "发现问题: $ISSUES_FOUND"
fi
if [ -n "$NEXT_STEPS" ] && [ "$NEXT_STEPS" != "" ]; then
    log_info "建议下一步: $NEXT_STEPS"
fi

# ===== Load Feature Plan =====

# 这里简化处理，实际应从数据库读取 Feature 和 Plan
# 假设 Feature Plan 存储在临时文件中（实际应从数据库读取）

# 模拟 Feature Plan
FEATURE_PLAN_FILE="/tmp/feature-${FEATURE_ID}-plan.json"

if [ ! -f "$FEATURE_PLAN_FILE" ]; then
    log_warn "Feature Plan 不存在，创建默认 Plan"

    # 创建默认 Plan（3 个 Tasks）
    cat > "$FEATURE_PLAN_FILE" <<EOF
{
  "feature_id": "$FEATURE_ID",
  "title": "Test Feature",
  "tasks": [
    {"id": "task-001", "status": "completed", "order": 1},
    {"id": "task-002", "status": "draft", "order": 2},
    {"id": "task-003", "status": "draft", "order": 3}
  ],
  "current_task_index": 1
}
EOF
fi

# 读取当前 Task 索引
CURRENT_INDEX=$(jq -r '.current_task_index' "$FEATURE_PLAN_FILE")
TOTAL_TASKS=$(jq -r '.tasks | length' "$FEATURE_PLAN_FILE")

log_info "当前进度: Task $((CURRENT_INDEX + 1)) / $TOTAL_TASKS"

# ===== Analyze Feedback & Adjust Plan =====

PLAN_ADJUSTED=false
TASKS_INSERTED=0

# 简单规则：如果反馈中提到"需要"、"应该"，则插入新 Task
if echo "$NEXT_STEPS" | grep -qE '需要|应该|建议'; then
    log_warn "检测到需要调整计划（基于反馈建议）"
    PLAN_ADJUSTED=true

    # 插入新 Task（简化版，实际应调用 LLM 生成）
    NEW_TASK_ID="task-00$((CURRENT_INDEX + 2))"
    NEW_TASK_TITLE="根据反馈调整：$NEXT_STEPS"

    log_info "插入新 Task: $NEW_TASK_ID - $NEW_TASK_TITLE"
    TASKS_INSERTED=1

    # 更新 Plan（插入新 Task）
    jq --arg id "$NEW_TASK_ID" --arg title "$NEW_TASK_TITLE" \
       '.tasks += [{"id": $id, "title": $title, "status": "draft", "order": (.tasks | length + 1)}]' \
       "$FEATURE_PLAN_FILE" > /tmp/plan-updated.json
    mv /tmp/plan-updated.json "$FEATURE_PLAN_FILE"
fi

# ===== Check Completion =====

# 判断 Feature 是否完成
# 规则：
# 1. 所有 Tasks 都是 completed
# 2. 反馈中明确说"完成"
# 3. 已经是最后一个 Task

FEATURE_COMPLETED=false
COMPLETION_REASON=""

# 检查是否是最后一个 Task
if [ "$CURRENT_INDEX" -ge "$((TOTAL_TASKS - 1))" ]; then
    # 最后一个 Task
    if echo "$FEEDBACK_SUMMARY" | grep -qE '完成|成功|done|completed'; then
        FEATURE_COMPLETED=true
        COMPLETION_REASON="最后一个 Task 已完成，且反馈确认成功"
        log_success "Feature 已完成: $COMPLETION_REASON"
    fi
fi

# ===== Generate Next Task (if not completed) =====

if [ "$FEATURE_COMPLETED" = "false" ]; then
    # 细化下一个 Task 的 PRD
    NEXT_INDEX=$((CURRENT_INDEX + 1))
    NEXT_TASK_ID="task-00$((NEXT_INDEX + 1))"
    NEXT_TASK_TITLE="Task $((NEXT_INDEX + 1))：基于反馈的下一步"

    log_info "细化 Task $((NEXT_INDEX + 1)) 的 PRD"

    # 生成详细 PRD（简化版，实际应调用 LLM）
    NEXT_TASK_PRD="# $NEXT_TASK_TITLE

## 基于上一个 Task 的反馈

**上一步完成情况**：
$FEEDBACK_SUMMARY

**发现的问题**：
$ISSUES_FOUND

**建议的下一步**：
$NEXT_STEPS

## 实现方案

1. 解决上一步发现的问题
2. 实现建议的功能
3. 编写测试

## 验收标准

- 上一步的问题已解决
- 新功能实现完成
- 测试通过
"

    # 更新 Plan（当前 Task 索引前进）
    jq ".current_task_index = $NEXT_INDEX" "$FEATURE_PLAN_FILE" > /tmp/plan-updated.json
    mv /tmp/plan-updated.json "$FEATURE_PLAN_FILE"

    # 输出 JSON
    cat <<EOF
{
  "feedback_read": true,
  "plan_adjusted": $PLAN_ADJUSTED,
  "tasks_inserted": $TASKS_INSERTED,
  "next_task": {
    "id": "$NEXT_TASK_ID",
    "title": "$NEXT_TASK_TITLE",
    "prd_status": "detailed",
    "prd_content": $(echo "$NEXT_TASK_PRD" | jq -Rs .)
  },
  "feature_completed": false
}
EOF

else
    # Feature 完成
    cat <<EOF
{
  "feedback_read": true,
  "feature_completed": true,
  "completion_reason": "$COMPLETION_REASON"
}
EOF
fi

log_success "处理完成" >&2
