#!/usr/bin/env bash
# update-capability.sh - PR merge 后更新 Capability stage
#
# 用法: bash skills/dev/scripts/update-capability.sh [task_id]
#
# 流程:
#   1. 从参数或 .dev-mode 读取 task_id
#   2. GET /api/brain/tasks → 找到 pr_plan_id
#   3. GET /api/brain/pr-plans/:id → 找到 capability_id + to_stage
#   4. PATCH /api/brain/capabilities/:id → 更新 current_stage
#
# 降级: Brain 不可用 / 无关联 capability → 静默跳过，不阻塞流程

set -uo pipefail  # 注意：不用 -e，保证错误时静默继续

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TIMEOUT=5
DEV_MODE_FILE=".dev-mode"

# ============================================================================
# 获取 task_id
# ============================================================================

task_id="${1:-}"

if [[ -z "$task_id" ]] && [[ -f "$DEV_MODE_FILE" ]]; then
    task_id=$(grep "^task_id:" "$DEV_MODE_FILE" 2>/dev/null | head -1 | awk '{print $2}' || echo "")
fi

if [[ -z "$task_id" ]]; then
    echo "ℹ️  无 task_id，跳过 capability 更新"
    exit 0
fi

echo "🔍 检查 task $task_id 的 capability 关联..."

# ============================================================================
# 获取 PR Number（从 .dev-mode 或 git log）
# ============================================================================

pr_number=""
if [[ -f "$DEV_MODE_FILE" ]]; then
    pr_number=$(grep "^pr_number:\|^pr:" "$DEV_MODE_FILE" 2>/dev/null | head -1 | awk '{print $2}' || echo "")
fi
if [[ -z "$pr_number" ]]; then
    # 尝试从最近 git log 中找 PR 号
    pr_number=$(git log --oneline -5 2>/dev/null | grep -oP '#\d+' | head -1 | tr -d '#' || echo "")
fi

evidence="PR #${pr_number:-?} merged via /dev"

# ============================================================================
# Step 1: 通过 task_id 找 pr_plan_id
# ============================================================================

tasks_response=$(curl --silent --max-time "$TIMEOUT" \
    "$BRAIN_URL/api/brain/tasks?limit=500" \
    2>/dev/null || echo "")

if [[ -z "$tasks_response" ]]; then
    echo "⚠️  Brain API 不可用，跳过 capability 更新"
    exit 0
fi

pr_plan_id=$(echo "$tasks_response" | jq -r \
    ".[] | select(.id == \"$task_id\") | .pr_plan_id // empty" \
    2>/dev/null || echo "")

if [[ -z "$pr_plan_id" ]] || [[ "$pr_plan_id" == "null" ]]; then
    echo "ℹ️  task $task_id 无关联 pr_plan，跳过"
    exit 0
fi

# ============================================================================
# Step 2: 通过 pr_plan_id 找 capability_id + to_stage
# ============================================================================

plan_response=$(curl --silent --max-time "$TIMEOUT" \
    "$BRAIN_URL/api/brain/pr-plans/$pr_plan_id" \
    2>/dev/null || echo "")

if [[ -z "$plan_response" ]]; then
    echo "⚠️  无法获取 pr_plan $pr_plan_id，跳过"
    exit 0
fi

capability_id=$(echo "$plan_response" | jq -r '.pr_plan.capability_id // empty' 2>/dev/null || echo "")
to_stage=$(echo "$plan_response" | jq -r '.pr_plan.to_stage // empty' 2>/dev/null || echo "")

if [[ -z "$capability_id" ]] || [[ "$capability_id" == "null" ]]; then
    echo "ℹ️  pr_plan 无 capability_id，跳过"
    exit 0
fi

if [[ -z "$to_stage" ]] || [[ "$to_stage" == "null" ]]; then
    echo "ℹ️  pr_plan 无 to_stage，跳过"
    exit 0
fi

# ============================================================================
# Step 3: 获取当前 stage，检查是否需要更新
# ============================================================================

cap_response=$(curl --silent --max-time "$TIMEOUT" \
    "$BRAIN_URL/api/brain/capabilities/$capability_id" \
    2>/dev/null || echo "")

if [[ -z "$cap_response" ]]; then
    echo "⚠️  无法获取 capability $capability_id，跳过"
    exit 0
fi

current_stage=$(echo "$cap_response" | jq -r '.capability.current_stage // empty' 2>/dev/null || echo "")
cap_name=$(echo "$cap_response" | jq -r '.capability.name // "?"' 2>/dev/null || echo "?")

if [[ -z "$current_stage" ]]; then
    echo "⚠️  无法读取 current_stage，跳过"
    exit 0
fi

if [[ "$current_stage" -ge "$to_stage" ]]; then
    echo "ℹ️  [$cap_name] 当前 stage=$current_stage ≥ to_stage=$to_stage，无需更新"
    exit 0
fi

# ============================================================================
# Step 4: PATCH capability — 推进 stage
# ============================================================================

echo "🚀 更新 [$cap_name]: stage $current_stage → $to_stage"

request_body=$(jq -n \
    --argjson stage "$to_stage" \
    --arg evidence "$evidence" \
    '{current_stage: $stage, evidence: $evidence}')

patch_response=$(curl --silent --max-time "$TIMEOUT" \
    -X PATCH "$BRAIN_URL/api/brain/capabilities/$capability_id" \
    -H "Content-Type: application/json" \
    -d "$request_body" \
    2>/dev/null || echo "")

if echo "$patch_response" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "✅ Capability [$cap_name] 已推进到 stage $to_stage"
else
    err=$(echo "$patch_response" | jq -r '.error // "未知错误"' 2>/dev/null || echo "响应为空")
    echo "⚠️  Capability 更新失败: $err（不影响主流程）"
fi

exit 0
