#!/usr/bin/env bash
# check-branch-naming.test.sh — scripts/ci/check-branch-naming.sh 行为回归测试
set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/check-branch-naming.sh"

PASS=0; FAIL=0

assert_pass() {
  local label="$1" branch="$2"
  if bash "$SCRIPT" "$branch" >/dev/null 2>&1; then
    echo "✅ $label: pass as expected ($branch)"; PASS=$((PASS+1))
  else
    echo "❌ $label: expected pass but got fail ($branch)"; FAIL=$((FAIL+1))
  fi
}

assert_fail() {
  local label="$1" branch="$2"
  if bash "$SCRIPT" "$branch" >/dev/null 2>&1; then
    echo "❌ $label: expected fail but got pass ($branch)"; FAIL=$((FAIL+1))
  else
    echo "✅ $label: fail as expected ($branch)"; PASS=$((PASS+1))
  fi
}

assert_pass "基础分支 main"       "main"
assert_pass "cp-* 8位时间戳"      "cp-07211200-fix-something"
assert_pass "cp-* 10位时间戳"     "cp-0721120059-fix-something"
assert_pass "dependabot 单包"     "dependabot/npm_and_yarn/axios-1.18.0"
assert_pass "dependabot 多包组"   "dependabot/npm_and_yarn/packages/engine/brace-expansion-and-vitest-coverage-v8-3.2.4-4.1.10"
assert_fail "随意命名分支"        "random-feature-branch"
assert_fail "feature/* 分支"      "feature/something"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
