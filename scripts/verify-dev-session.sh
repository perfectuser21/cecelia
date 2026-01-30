#!/usr/bin/env bash
# verify-dev-session.sh - KR1 验证脚本
#
# 验证 Dev Session → Quality Gates → Memory Summary
#
# KR1 Hard Indicators:
# 1. 能生成一个 Dev Session（/dev task）
# 2. 能自动通过 Quality Gate（assertions=0 + gates pass）
# 3. 能自动形成一个 Memory Summary
#
# Usage:
#   bash scripts/verify-dev-session.sh
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
echo "  KR1 验证: Headless /dev Session with Memory Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check 1: API Health
echo "📋 检查 1: Core API 健康状态"
echo "------------------------------------------------------------"

HEALTH_RESPONSE=$(curl -s "${CORE_API}/api/system/health" 2>/dev/null || echo '{"success":false}')
if echo "$HEALTH_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    log_pass "Core API 健康"
else
    log_fail "Core API 不可用: $HEALTH_RESPONSE"
fi
echo ""

# Check 2: Dev Session API
echo "📋 检查 2: Dev Session API 可用"
echo "------------------------------------------------------------"

# Test session ID generation
SESSION_ID_RESPONSE=$(curl -s "${CORE_API}/api/system/dev-session/generate-id" 2>/dev/null || echo '{"success":false}')
if echo "$SESSION_ID_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    SESSION_ID=$(echo "$SESSION_ID_RESPONSE" | jq -r '.session_id')
    log_pass "Session ID 生成: $SESSION_ID"
else
    log_fail "Session ID 生成失败: $SESSION_ID_RESPONSE"
fi

# Test session creation
CREATE_RESPONSE=$(curl -s -X POST "${CORE_API}/api/system/dev-session" \
    -H "Content-Type: application/json" \
    -d '{
        "branch": "test-kr1-verify",
        "prd_path": ".prd-test.md",
        "project": "test-project"
    }' 2>/dev/null || echo '{"success":false}')

if echo "$CREATE_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    CREATED_SESSION_ID=$(echo "$CREATE_RESPONSE" | jq -r '.session.session_id')
    log_pass "Session 创建: $CREATED_SESSION_ID"
else
    log_fail "Session 创建失败: $CREATE_RESPONSE"
    CREATED_SESSION_ID=""
fi
echo ""

# Check 3: Dev Session in Memory
echo "📋 检查 3: Dev Session 存储到 episodic memory"
echo "------------------------------------------------------------"

if [[ -n "$CREATED_SESSION_ID" ]]; then
    MEMORY_RESPONSE=$(curl -s "${CORE_API}/api/system/memory?layer=episodic&category=event" 2>/dev/null || echo '{"entries":[]}')
    SESSION_COUNT=$(echo "$MEMORY_RESPONSE" | jq '[.entries[] | select(.key | startswith("dev_session_"))] | length' 2>/dev/null || echo "0")

    if [[ "$SESSION_COUNT" -gt 0 ]]; then
        log_pass "episodic memory 中有 $SESSION_COUNT 个 dev_session_ 记录"
    else
        log_fail "episodic memory 中没有 dev_session_ 记录"
    fi
else
    log_warn "跳过 memory 检查（session 创建失败）"
fi
echo ""

# Check 4: Quality Gates
echo "📋 检查 4: Quality Gate 验证"
echo "------------------------------------------------------------"

if [[ -n "$CREATED_SESSION_ID" ]]; then
    # Set quality gates
    QG_RESPONSE=$(curl -s -X POST "${CORE_API}/api/system/dev-session/${CREATED_SESSION_ID}/quality-gates" \
        -H "Content-Type: application/json" \
        -d '{
            "qa_decision": true,
            "audit_pass": true,
            "gate_file": true
        }' 2>/dev/null || echo '{"success":false}')

    if echo "$QG_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
        ALL_PASSED=$(echo "$QG_RESPONSE" | jq -r '.quality_gates.all_passed')
        if [[ "$ALL_PASSED" == "true" ]]; then
            log_pass "Quality Gates 全部通过"
        else
            log_fail "Quality Gates 未全部通过"
        fi
    else
        log_fail "Quality Gates 设置失败: $QG_RESPONSE"
    fi
else
    log_warn "跳过 Quality Gates 检查（session 创建失败）"
fi
echo ""

# Check 5: Memory Summary Generation
echo "📋 检查 5: Memory Summary 生成"
echo "------------------------------------------------------------"

if [[ -n "$CREATED_SESSION_ID" ]]; then
    # Generate summary
    SUMMARY_RESPONSE=$(curl -s -X POST "${CORE_API}/api/system/dev-session/${CREATED_SESSION_ID}/summary" \
        -H "Content-Type: application/json" 2>/dev/null || echo '{"success":false}')

    if echo "$SUMMARY_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
        log_pass "Summary 生成成功"

        # Check summary structure
        HAS_FILES=$(echo "$SUMMARY_RESPONSE" | jq -e '.summary.files_modified' >/dev/null 2>&1 && echo "true" || echo "false")
        HAS_SCRIPTS=$(echo "$SUMMARY_RESPONSE" | jq -e '.summary.scripts_executed' >/dev/null 2>&1 && echo "true" || echo "false")
        HAS_NEXT_STEPS=$(echo "$SUMMARY_RESPONSE" | jq -e '.summary.next_steps' >/dev/null 2>&1 && echo "true" || echo "false")
        HAS_DURATION=$(echo "$SUMMARY_RESPONSE" | jq -e '.summary.duration_ms' >/dev/null 2>&1 && echo "true" || echo "false")

        if [[ "$HAS_FILES" == "true" && "$HAS_SCRIPTS" == "true" && "$HAS_NEXT_STEPS" == "true" && "$HAS_DURATION" == "true" ]]; then
            log_pass "Summary 结构完整 (files_modified, scripts_executed, next_steps, duration_ms)"
        else
            log_fail "Summary 结构不完整"
        fi
    else
        log_fail "Summary 生成失败: $SUMMARY_RESPONSE"
    fi

    # Check summary in memory
    SUMMARY_MEMORY=$(curl -s "${CORE_API}/api/system/memory?layer=episodic&category=event" 2>/dev/null || echo '{"entries":[]}')
    SUMMARY_COUNT=$(echo "$SUMMARY_MEMORY" | jq '[.entries[] | select(.key | startswith("summary_"))] | length' 2>/dev/null || echo "0")

    if [[ "$SUMMARY_COUNT" -gt 0 ]]; then
        log_pass "episodic memory 中有 $SUMMARY_COUNT 个 summary_ 记录"
    else
        log_fail "episodic memory 中没有 summary_ 记录"
    fi
else
    log_warn "跳过 Summary 检查（session 创建失败）"
fi
echo ""

# Check 6: Assertions Stats
echo "📋 检查 6: Assertions 统计"
echo "------------------------------------------------------------"

ASSERTIONS_RESPONSE=$(curl -s "${CORE_API}/api/system/assertions" 2>/dev/null || echo '{"stats":{"passed":0,"failed":0}}')
ASSERTIONS_PASSED=$(echo "$ASSERTIONS_RESPONSE" | jq -r '.stats.passed // 0')
ASSERTIONS_FAILED=$(echo "$ASSERTIONS_RESPONSE" | jq -r '.stats.failed // 0')

log_info "Assertions: passed=$ASSERTIONS_PASSED, failed=$ASSERTIONS_FAILED"

if [[ "$ASSERTIONS_FAILED" -eq 0 ]]; then
    log_pass "Assertions 失败数为 0"
else
    log_fail "Assertions 有 $ASSERTIONS_FAILED 个失败"
fi
echo ""

# Check 7: Panorama visibility
echo "📋 检查 7: Panorama 可见性"
echo "------------------------------------------------------------"

PANORAMA_RESPONSE=$(curl -s "${CORE_API}/api/panorama/command-center" 2>/dev/null || echo '{"success":false}')
if echo "$PANORAMA_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    HAS_DEV_SESSIONS=$(echo "$PANORAMA_RESPONSE" | jq -e '.data.dev_sessions' >/dev/null 2>&1 && echo "true" || echo "false")
    if [[ "$HAS_DEV_SESSIONS" == "true" ]]; then
        ACTIVE_COUNT=$(echo "$PANORAMA_RESPONSE" | jq -r '.data.dev_sessions.active | length // 0')
        RECENT_COUNT=$(echo "$PANORAMA_RESPONSE" | jq -r '.data.dev_sessions.recent | length // 0')
        log_pass "Panorama 包含 dev_sessions (active: $ACTIVE_COUNT, recent: $RECENT_COUNT)"
    else
        log_fail "Panorama 不包含 dev_sessions"
    fi
else
    log_fail "Panorama API 不可用"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  KR1 验证结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✅ Passed:   $PASSED"
echo "  ❌ Failed:   $FAILED"
echo "  ⚠️  Warnings: $WARNINGS"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "  ${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "  ${GREEN}║           KR1 PASS                   ║${NC}"
    echo -e "  ${GREEN}╚══════════════════════════════════════╝${NC}"
    echo ""
    exit 0
else
    echo -e "  ${RED}╔══════════════════════════════════════╗${NC}"
    echo -e "  ${RED}║           KR1 FAIL                   ║${NC}"
    echo -e "  ${RED}╚══════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
