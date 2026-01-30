#!/usr/bin/env bash
# verify-live-dashboard.sh - KR3 验证脚本
#
# 测试 Live Dashboard API 可用性 + 数据一致性
#
# KR3 Hard Indicators:
# 1. /api/system/live 返回聚合数据
# 2. 数据结构正确且一致
# 3. 状态枚举值有效
#
# Usage:
#   bash scripts/verify-live-dashboard.sh
#
# Environment:
#   CORE_API - Core API URL (default: http://localhost:5212)

set -euo pipefail

# Configuration
CORE_API="${CORE_API:-http://localhost:5212}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0
WARNINGS=0

log_pass() { echo -e "${GREEN}✅ PASS${NC}: $*"; ((++PASSED)) || true; }
log_fail() { echo -e "${RED}❌ FAIL${NC}: $*"; ((++FAILED)) || true; }
log_warn() { echo -e "${YELLOW}⚠️  WARN${NC}: $*"; ((++WARNINGS)) || true; }
log_info() { echo -e "ℹ️  INFO: $*"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  KR3 验证: Live Dashboard API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Fetch live data once
LIVE_RESPONSE=$(curl -s "${CORE_API}/api/system/live" 2>/dev/null || echo '{"success":false}')

# Check 1: API Returns 200
echo "📋 检查 1: /api/system/live 返回 200"
echo "------------------------------------------------------------"

if echo "$LIVE_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    log_pass "/api/system/live 返回成功"
else
    log_fail "/api/system/live 返回失败: $LIVE_RESPONSE"
fi
echo ""

# Check 2: health.* 全部存在
echo "📋 检查 2: health.* 全部存在"
echo "------------------------------------------------------------"

HEALTH_WORKSPACE=$(echo "$LIVE_RESPONSE" | jq -r '.data.health.workspace // "missing"')
HEALTH_BRAIN=$(echo "$LIVE_RESPONSE" | jq -r '.data.health.brain // "missing"')
HEALTH_QUALITY=$(echo "$LIVE_RESPONSE" | jq -r '.data.health.quality // "missing"')
HEALTH_N8N=$(echo "$LIVE_RESPONSE" | jq -r '.data.health.n8n // "missing"')

if [[ "$HEALTH_WORKSPACE" != "missing" && "$HEALTH_BRAIN" != "missing" && "$HEALTH_QUALITY" != "missing" && "$HEALTH_N8N" != "missing" ]]; then
    log_pass "health 字段完整 (workspace=$HEALTH_WORKSPACE, brain=$HEALTH_BRAIN, quality=$HEALTH_QUALITY, n8n=$HEALTH_N8N)"
else
    log_fail "health 字段缺失: workspace=$HEALTH_WORKSPACE, brain=$HEALTH_BRAIN, quality=$HEALTH_QUALITY, n8n=$HEALTH_N8N"
fi
echo ""

# Check 3: governance.dlq_count 是数字
echo "📋 检查 3: governance.dlq_count 是数字"
echo "------------------------------------------------------------"

DLQ_COUNT=$(echo "$LIVE_RESPONSE" | jq -r '.data.governance.dlq_count // "missing"')
if [[ "$DLQ_COUNT" =~ ^[0-9]+$ ]]; then
    log_pass "dlq_count 是数字: $DLQ_COUNT"
else
    log_fail "dlq_count 不是数字: $DLQ_COUNT"
fi
echo ""

# Check 4: governance.degrade_status 是枚举
echo "📋 检查 4: governance.degrade_status 是枚举"
echo "------------------------------------------------------------"

DEGRADE_STATUS=$(echo "$LIVE_RESPONSE" | jq -r '.data.governance.degrade_status // "missing"')
if [[ "$DEGRADE_STATUS" == "normal" || "$DEGRADE_STATUS" == "degraded" ]]; then
    log_pass "degrade_status 是有效枚举: $DEGRADE_STATUS"
else
    log_fail "degrade_status 不是有效枚举: $DEGRADE_STATUS (expected: normal/degraded)"
fi
echo ""

# Check 5: governance.assertions.passed/failed 是数字
echo "📋 检查 5: governance.assertions.passed/failed 是数字"
echo "------------------------------------------------------------"

ASSERTIONS_PASSED=$(echo "$LIVE_RESPONSE" | jq -r '.data.governance.assertions.passed // "missing"')
ASSERTIONS_FAILED=$(echo "$LIVE_RESPONSE" | jq -r '.data.governance.assertions.failed // "missing"')

if [[ "$ASSERTIONS_PASSED" =~ ^[0-9]+$ && "$ASSERTIONS_FAILED" =~ ^[0-9]+$ ]]; then
    log_pass "assertions 是数字: passed=$ASSERTIONS_PASSED, failed=$ASSERTIONS_FAILED"
else
    log_fail "assertions 不是数字: passed=$ASSERTIONS_PASSED, failed=$ASSERTIONS_FAILED"
fi
echo ""

# Check 6: dev_sessions[].status 必须属于 {running, completed, failed}
echo "📋 检查 6: dev_sessions[].status 枚举验证"
echo "------------------------------------------------------------"

SESSION_COUNT=$(echo "$LIVE_RESPONSE" | jq '.data.dev_sessions | length' 2>/dev/null || echo "0")
INVALID_STATUSES=$(echo "$LIVE_RESPONSE" | jq -r '.data.dev_sessions[].status' 2>/dev/null | grep -v -E '^(running|completed|failed)$' | head -1 || true)

if [[ -z "$INVALID_STATUSES" ]]; then
    log_pass "所有 $SESSION_COUNT 个 session 状态有效 (running/completed/failed)"
else
    log_fail "发现无效 session 状态: $INVALID_STATUSES"
fi
echo ""

# Check 7: completed session 必须有 summary.duration_ms
echo "📋 检查 7: completed session 有 duration_ms"
echo "------------------------------------------------------------"

COMPLETED_COUNT=$(echo "$LIVE_RESPONSE" | jq '[.data.dev_sessions[] | select(.status == "completed")] | length' 2>/dev/null || echo "0")
COMPLETED_WITHOUT_DURATION=$(echo "$LIVE_RESPONSE" | jq '[.data.dev_sessions[] | select(.status == "completed" and (.summary.duration_ms == null or .summary.duration_ms == 0))] | length' 2>/dev/null || echo "0")

if [[ "$COMPLETED_COUNT" -eq 0 ]]; then
    log_warn "没有 completed session，跳过此检查"
elif [[ "$COMPLETED_WITHOUT_DURATION" -eq 0 ]]; then
    log_pass "$COMPLETED_COUNT 个 completed session 都有 duration_ms"
else
    log_fail "$COMPLETED_WITHOUT_DURATION 个 completed session 缺少 duration_ms"
fi
echo ""

# Check 8: timestamp 存在且格式正确
echo "📋 检查 8: timestamp 存在且格式正确"
echo "------------------------------------------------------------"

TIMESTAMP=$(echo "$LIVE_RESPONSE" | jq -r '.data.timestamp // "missing"')
if [[ "$TIMESTAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2} ]]; then
    log_pass "timestamp 格式正确: $TIMESTAMP"
else
    log_fail "timestamp 格式错误或缺失: $TIMESTAMP"
fi
echo ""

# Check 9: tasks 是数组
echo "📋 检查 9: tasks 是数组"
echo "------------------------------------------------------------"

TASKS_TYPE=$(echo "$LIVE_RESPONSE" | jq -r '.data.tasks | type' 2>/dev/null || echo "missing")
TASKS_COUNT=$(echo "$LIVE_RESPONSE" | jq '.data.tasks | length' 2>/dev/null || echo "0")

if [[ "$TASKS_TYPE" == "array" ]]; then
    log_pass "tasks 是数组，包含 $TASKS_COUNT 个任务"
else
    log_fail "tasks 不是数组: type=$TASKS_TYPE"
fi
echo ""

# Check 10: plan 字段存在
echo "📋 检查 10: plan 字段存在"
echo "------------------------------------------------------------"

PLAN_EXISTS=$(echo "$LIVE_RESPONSE" | jq -e '.data.plan' >/dev/null 2>&1 && echo "true" || echo "false")
if [[ "$PLAN_EXISTS" == "true" ]]; then
    PLAN_ID=$(echo "$LIVE_RESPONSE" | jq -r '.data.plan.last_plan_id // "null"')
    PLAN_SCOPE=$(echo "$LIVE_RESPONSE" | jq -r '.data.plan.scope // "null"')
    log_pass "plan 字段存在 (id=$PLAN_ID, scope=$PLAN_SCOPE)"
else
    log_fail "plan 字段不存在"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  KR3 验证结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✅ Passed:   $PASSED"
echo "  ❌ Failed:   $FAILED"
echo "  ⚠️  Warnings: $WARNINGS"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "  ${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "  ${GREEN}║           KR3 PASS                   ║${NC}"
    echo -e "  ${GREEN}╚══════════════════════════════════════╝${NC}"
    echo ""
    exit 0
else
    echo -e "  ${RED}╔══════════════════════════════════════╗${NC}"
    echo -e "  ${RED}║           KR3 FAIL                   ║${NC}"
    echo -e "  ${RED}╚══════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
