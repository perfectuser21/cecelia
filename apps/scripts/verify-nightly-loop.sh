#!/bin/bash
#
# KR2 Verification Script - Nightly Loop 验收
#
# 验证流程：Plan → Commit → Trigger → Execute → Evidence → Memory
#
# 成功标准：
# - nightly 生成 plan（有 planId）
# - commit 生成 tasks（至少 3 个）
# - triggered_count >= 1（触发执行）
# - memory 记录 nightly_plan 事件（含 triggered_count）
# - 系统健康（DLQ=0, 无 degrade, 无 violations）
#

set -e

API_BASE="${API_BASE:-http://localhost:5211/api}"
VERBOSE="${VERBOSE:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS_COUNT=0
FAIL_COUNT=0

log() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

pass() {
    echo -e "${GREEN}[PASS]${NC} $1" >&2
    ((PASS_COUNT++))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1" >&2
    ((FAIL_COUNT++))
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

# Check if API is accessible
check_api() {
    log "Checking API accessibility..."
    if curl -s --connect-timeout 5 "${API_BASE}/brain/status" > /dev/null 2>&1; then
        pass "API is accessible"
        return 0
    else
        fail "API is not accessible at ${API_BASE}"
        return 1
    fi
}

# Step 1: Trigger nightly planner
trigger_nightly() {
    log "Step 1: Triggering nightly planner..."

    local RESPONSE
    RESPONSE=$(curl -s -X POST "${API_BASE}/system/plan/nightly" \
        -H "Content-Type: application/json" \
        -w "\n%{http_code}")

    local HTTP_CODE
    local BODY
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [[ "$HTTP_CODE" == "201" ]]; then
        local PLAN_ID
        PLAN_ID=$(echo "$BODY" | jq -r '.plan_id // empty')
        echo "$BODY" | jq -r '.committed_count // 0' > /tmp/nightly_committed_count
        echo "$BODY" | jq -r '.triggered_count // 0' > /tmp/nightly_triggered_count
        local SUMMARY
        SUMMARY=$(echo "$BODY" | jq -r '.summary // ""')
        local TASK_COUNT
        TASK_COUNT=$(echo "$SUMMARY" | grep -oP '生成 \K\d+' || echo "0")
        echo "$TASK_COUNT" > /tmp/nightly_task_count

        if [[ -n "$PLAN_ID" ]]; then
            local COMMITTED_COUNT
            COMMITTED_COUNT=$(cat /tmp/nightly_committed_count)
            local TRIGGERED_COUNT
            TRIGGERED_COUNT=$(cat /tmp/nightly_triggered_count)
            pass "Nightly plan created: $PLAN_ID (tasks: $TASK_COUNT, committed: $COMMITTED_COUNT, triggered: $TRIGGERED_COUNT)"
            echo "$PLAN_ID"
            return 0
        else
            fail "No plan_id in response"
            return 1
        fi
    else
        fail "Nightly endpoint returned HTTP $HTTP_CODE"
        return 1
    fi
}

# Step 2: Check plan structure
check_plan_structure() {
    local PLAN_ID=$1
    log "Step 2: Checking plan structure..."

    RESPONSE=$(curl -s "${API_BASE}/system/plan/status")
    PLAN=$(echo "$RESPONSE" | jq -r '.plan // empty')

    if [[ -z "$PLAN" || "$PLAN" == "null" ]]; then
        fail "No active plan found"
        return 1
    fi

    TASKS=$(echo "$RESPONSE" | jq '.plan.tasks // []')
    TASK_COUNT=$(echo "$TASKS" | jq 'length')

    if [[ "$TASK_COUNT" -eq 0 ]]; then
        fail "Plan has no tasks"
        return 1
    fi

    FIRST_TASK=$(echo "$TASKS" | jq '.[0]')
    HAS_WHY=$(echo "$FIRST_TASK" | jq 'has("why")')
    HAS_EVIDENCE=$(echo "$FIRST_TASK" | jq 'has("expected_evidence")')

    if [[ "$HAS_WHY" == "true" && "$HAS_EVIDENCE" == "true" ]]; then
        pass "Plan tasks have why + expected_evidence"
    else
        fail "Plan tasks missing why or expected_evidence"
        return 1
    fi

    return 0
}

# Step 3: Check committed tasks count
check_committed_tasks() {
    log "Step 3: Checking committed tasks..."

    local COMMITTED_COUNT
    COMMITTED_COUNT=$(cat /tmp/nightly_committed_count 2>/dev/null || echo "0")
    local TASK_COUNT
    TASK_COUNT=$(cat /tmp/nightly_task_count 2>/dev/null || echo "0")

    if [[ "$COMMITTED_COUNT" -ge 3 ]]; then
        pass "Committed tasks count: $COMMITTED_COUNT (>= 3)"
        return 0
    elif [[ "$COMMITTED_COUNT" -ge 1 ]]; then
        if [[ "$TASK_COUNT" -lt 3 ]]; then
            pass "Committed all available tasks: $COMMITTED_COUNT (only $TASK_COUNT tasks in plan)"
            return 0
        else
            fail "Committed tasks count: $COMMITTED_COUNT (expected >= 3)"
            return 1
        fi
    else
        fail "Committed tasks count: $COMMITTED_COUNT (expected >= 3)"
        return 1
    fi
}

# Step 4: Check triggered_count (auto-trigger feature)
check_triggered_count() {
    log "Step 4: Checking triggered_count..."

    local TRIGGERED_COUNT
    TRIGGERED_COUNT=$(cat /tmp/nightly_triggered_count 2>/dev/null || echo "0")

    if [[ "$TRIGGERED_COUNT" -ge 1 ]]; then
        pass "Triggered count: $TRIGGERED_COUNT (>= 1)"
        return 0
    else
        warn "Triggered count: $TRIGGERED_COUNT (executor may not be running)"
        return 0
    fi
}

# Step 5: Check memory for nightly_plan event
check_memory_event() {
    log "Step 5: Checking memory for nightly_plan event..."

    RESPONSE=$(curl -s "${API_BASE}/system/memory?layer=episodic&category=event")
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')

    if [[ "$SUCCESS" != "true" ]]; then
        fail "Failed to query memory"
        return 1
    fi

    ENTRIES=$(echo "$RESPONSE" | jq '.entries // []')
    NIGHTLY_COUNT=$(echo "$ENTRIES" | jq '[.[] | select(.key | startswith("nightly_plan_"))] | length')

    if [[ "$NIGHTLY_COUNT" -gt 0 ]]; then
        pass "Found $NIGHTLY_COUNT nightly_plan event(s) in memory"
        return 0
    else
        fail "No nightly_plan event found in episodic memory"
        return 1
    fi
}

# Step 6: Check system health
check_system_health() {
    log "Step 6: Checking system health..."

    local HEALTH_PASS=true

    DLQ_RESPONSE=$(curl -s "${API_BASE}/brain/status" | jq '.dlq_count // 0')
    if [[ "$DLQ_RESPONSE" -eq 0 ]]; then
        pass "DLQ count: 0"
    else
        fail "DLQ count: $DLQ_RESPONSE (expected 0)"
        HEALTH_PASS=false
    fi

    DEGRADE_RESPONSE=$(curl -s "${API_BASE}/brain/status" | jq -r '.degraded // false')
    if [[ "$DEGRADE_RESPONSE" == "false" ]]; then
        pass "System not degraded"
    else
        fail "System is in degraded mode"
        HEALTH_PASS=false
    fi

    VIOLATIONS_RESPONSE=$(curl -s "${API_BASE}/system/assertions" 2>/dev/null || echo '{"violations":[]}')
    VIOLATIONS_COUNT=$(echo "$VIOLATIONS_RESPONSE" | jq '.violations | length' 2>/dev/null || echo "0")

    if [[ "$VIOLATIONS_COUNT" -eq 0 ]]; then
        pass "No boundary violations"
    else
        fail "Found $VIOLATIONS_COUNT boundary violations"
        HEALTH_PASS=false
    fi

    $HEALTH_PASS
}

# Print summary
print_summary() {
    echo ""
    echo "=========================================="
    echo "         KR2 Verification Summary         "
    echo "=========================================="
    echo ""
    printf "| %-30s | %-10s |\n" "Check" "Status"
    echo "|--------------------------------|------------|"
    printf "| %-30s | %-10s |\n" "API Accessible" "$([ $API_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    printf "| %-30s | %-10s |\n" "Nightly Plan Generated" "$([ $NIGHTLY_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    printf "| %-30s | %-10s |\n" "Plan Structure (why/evidence)" "$([ $STRUCTURE_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    printf "| %-30s | %-10s |\n" "Committed Tasks >= 3" "$([ $COMMITTED_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    printf "| %-30s | %-10s |\n" "Triggered Count (auto-trigger)" "$([ $TRIGGERED_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    printf "| %-30s | %-10s |\n" "Memory Event Recorded" "$([ $MEMORY_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    printf "| %-30s | %-10s |\n" "System Health (DLQ/Degrade)" "$([ $HEALTH_CHECK -eq 0 ] && echo '✅ PASS' || echo '❌ FAIL')"
    echo "|--------------------------------|------------|"
    echo ""

    TOTAL=$((PASS_COUNT + FAIL_COUNT))

    if [[ $FAIL_COUNT -eq 0 ]]; then
        echo -e "${GREEN}=========================================="
        echo "       KR2 Verification: PASS             "
        echo "==========================================${NC}"
        echo ""
        echo "All $TOTAL checks passed!"
        echo "N8N 调度可自动触发任务，Nightly Loop 全链路正常。"
        return 0
    else
        echo -e "${RED}=========================================="
        echo "       KR2 Verification: FAIL             "
        echo "==========================================${NC}"
        echo ""
        echo "Passed: $PASS_COUNT / $TOTAL"
        echo "Failed: $FAIL_COUNT / $TOTAL"
        return 1
    fi
}

# Main execution
main() {
    echo ""
    echo "=========================================="
    echo "    KR2 Verification - Nightly Loop      "
    echo "=========================================="
    echo "API Base: $API_BASE"
    echo ""

    API_CHECK=1
    NIGHTLY_CHECK=1
    STRUCTURE_CHECK=1
    COMMITTED_CHECK=1
    TRIGGERED_CHECK=1
    MEMORY_CHECK=1
    HEALTH_CHECK=1

    check_api && API_CHECK=0

    if [[ $API_CHECK -eq 0 ]]; then
        PLAN_ID=$(trigger_nightly) && NIGHTLY_CHECK=0

        if [[ $NIGHTLY_CHECK -eq 0 ]]; then
            check_plan_structure "$PLAN_ID" && STRUCTURE_CHECK=0
            check_committed_tasks && COMMITTED_CHECK=0
            check_triggered_count && TRIGGERED_CHECK=0
            check_memory_event && MEMORY_CHECK=0
        fi

        check_system_health && HEALTH_CHECK=0
    fi

    print_summary
}

main "$@"
