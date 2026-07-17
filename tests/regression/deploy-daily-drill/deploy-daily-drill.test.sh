#!/usr/bin/env bash
# deploy-daily-drill.test.sh — FR-26 failing test fixture
# 初始状态：scripts/smoke/e2e/deploy-daily-drill.sh 不存在 → 此测试 FAIL
# 修复后：脚本存在且正确处理 fixture → PASS

set -euo pipefail

SCRIPT="scripts/smoke/e2e/deploy-daily-drill.sh"
PASS_COUNT=0
FAIL_COUNT=0

_pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT+1)); }
_fail() { echo "FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT+1)); }

# ── Fixture helpers ──
# 注入 mock 环境，让 deploy-daily-drill.sh 使用测试数据而非真实 GH API

# Test 1: 脚本存在检查（现版本必然 FAIL）
if [ ! -f "$SCRIPT" ]; then
  _fail "T1: deploy-daily-drill.sh 不存在 (expected to exist after implementation)"
else
  _pass "T1: deploy-daily-drill.sh 存在"
fi

# Test 2: merge 记录存在但无 deploy run → 应 exit 1（演习红）
if [ -f "$SCRIPT" ]; then
  # 注入 fixture：24h 内有 merge，但对应 deploy run SHA 不存在
  MOCK_MERGES='[{"number":9999,"merge_commit_sha":"abc1234","merged_at":"'$(date -u -d '-1 hour' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-1H '+%Y-%m-%dT%H:%M:%SZ')'","title":"test PR"}]'
  MOCK_RUNS='[]'  # 无 deploy run

  exit_code=0
  DRILL_MOCK_MERGES="$MOCK_MERGES" \
  DRILL_MOCK_RUNS="$MOCK_RUNS" \
  bash "$SCRIPT" 2>/dev/null || exit_code=$?

  if [ "$exit_code" -eq 1 ]; then
    _pass "T2: merge 无 deploy → exit 1（演习红）"
  else
    _fail "T2: 期望 exit 1，实际 exit $exit_code"
  fi
else
  _fail "T2: 无法测试（脚本不存在）"
fi

# Test 3: 无 merge 的日子 → exit 2（no_merge_skip）
if [ -f "$SCRIPT" ]; then
  MOCK_MERGES='[]'  # 无 merge
  exit_code=0
  output=""
  output=$(DRILL_MOCK_MERGES="$MOCK_MERGES" bash "$SCRIPT" 2>&1) || exit_code=$?

  if [ "$exit_code" -eq 2 ] && echo "$output" | grep -q "no_merge_skip"; then
    _pass "T3: 无 merge → exit 2 + no_merge_skip"
  else
    _fail "T3: 期望 exit 2+no_merge_skip，实际 exit $exit_code, output=$(echo "$output" | head -1)"
  fi
else
  _fail "T3: 无法测试（脚本不存在）"
fi

# Test 4: GH API 失败（DRILL_GH_API_FAIL=1）→ exit 2（fail open）
if [ -f "$SCRIPT" ]; then
  exit_code=0
  DRILL_GH_API_FAIL=1 bash "$SCRIPT" 2>/dev/null || exit_code=$?

  if [ "$exit_code" -eq 2 ]; then
    _pass "T4: GH API 失败 → exit 2（fail open）"
  else
    _fail "T4: 期望 exit 2，实际 exit $exit_code"
  fi
else
  _fail "T4: 无法测试（脚本不存在）"
fi

echo ""
echo "━━━ 结果: PASS=$PASS_COUNT FAIL=$FAIL_COUNT ━━━"
[ "$FAIL_COUNT" -eq 0 ] || exit 1
