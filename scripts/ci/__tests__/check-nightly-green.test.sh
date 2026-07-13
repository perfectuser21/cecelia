#!/usr/bin/env bash
# 单元测试: check-nightly-green.sh 各分支
# 用法: bash scripts/ci/__tests__/check-nightly-green.test.sh

set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/check-nightly-green.sh"
PASS=0
FAIL=0

run_test() {
  local name="$1"; shift
  if "$@" > /dev/null 2>&1; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL+1))
  fi
}

run_test_fail() {
  local name="$1"; shift
  if ! "$@" > /dev/null 2>&1; then
    echo "  ✅ $name (expected failure)"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name (expected failure but passed)"
    FAIL=$((FAIL+1))
  fi
}

echo "── check-nightly-green.sh 单元测试 ──────────────────────────────"

# T1: 缺少 GITHUB_REPOSITORY → exit 1
run_test_fail "T1: 缺 GITHUB_REPOSITORY exit=1" \
  env GITHUB_TOKEN=tok GITHUB_REPOSITORY="" bash "$SCRIPT"

# T2: 缺少 GITHUB_TOKEN → exit 1
run_test_fail "T2: 缺 GITHUB_TOKEN exit=1" \
  env GITHUB_TOKEN="" GITHUB_REPOSITORY="owner/repo" bash "$SCRIPT"

# T3: BYPASS_NIGHTLY_GATE=1 → exit 0（绕过所有检查）
run_test "T3: BYPASS=1 exit=0" \
  env GITHUB_TOKEN="tok" GITHUB_REPOSITORY="owner/repo" \
      BYPASS_NIGHTLY_GATE="1" bash "$SCRIPT"

echo ""
echo "结果: ${PASS} 通过  ${FAIL} 失败"
[ "$FAIL" -eq 0 ]
