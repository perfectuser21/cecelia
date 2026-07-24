#!/usr/bin/env bash
# conversation-ttl-archiver-smoke.sh
# 验收：主理人对话回路 PR4/4 — TTL 归档 job（task 61662df9，Brain 1.267.63）
# L1 静态：conversation-ttl-archiver.js 存在且导出 runConversationTtlArchiver
#          scheduler-jobs.js 注册了 conversation-ttl-archiver job
#          stop.sh 包含 decision_saved 协议对账段
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # packages/brain
ENGINE_ROOT="$(cd "$ROOT/../../packages/engine" && pwd)"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── L1：conversation-ttl-archiver.js 存在且导出正确 ──
echo "── L1 conversation-ttl-archiver.js 检查 ──"
ARCHIVER="$ROOT/src/conversation-ttl-archiver.js"
if [[ -f "$ARCHIVER" ]]; then
    ok "conversation-ttl-archiver.js 存在"
    if grep -q "export.*runConversationTtlArchiver" "$ARCHIVER"; then
        ok "runConversationTtlArchiver 已导出"
    else
        fail "runConversationTtlArchiver 未导出"
    fi
    if grep -q "ttl_expires_at" "$ARCHIVER"; then
        ok "UPDATE SQL 含 ttl_expires_at 过滤"
    else
        fail "conversation-ttl-archiver.js 缺少 ttl_expires_at 过滤"
    fi
else
    fail "conversation-ttl-archiver.js 不存在"
fi

# ── L1：scheduler-jobs.js 注册了 conversation-ttl-archiver ──
echo "── L1 scheduler-jobs.js 注册检查 ──"
SCHED="$ROOT/src/scheduler-jobs.js"
if grep -q "conversation-ttl-archiver" "$SCHED"; then
    ok "scheduler-jobs.js 注册了 conversation-ttl-archiver job"
else
    fail "scheduler-jobs.js 未找到 conversation-ttl-archiver 注册"
fi

# ── L1：stop.sh 包含 decision_saved 协议对账 ──
echo "── L1 stop.sh 协议对账段检查 ──"
STOP_SH="$ENGINE_ROOT/hooks/stop.sh"
if [[ -f "$STOP_SH" ]]; then
    if grep -q "decision_saved" "$STOP_SH"; then
        ok "stop.sh 含 decision_saved 协议对账段"
    else
        fail "stop.sh 未找到 decision_saved 对账段"
    fi
else
    fail "stop.sh 不存在"
fi

echo ""
echo "── 汇总 ──"
echo "PASS: $PASS, FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
