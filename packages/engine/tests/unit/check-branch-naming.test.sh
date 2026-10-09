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
# r41 案卷（run 5bfc1af9 / PR #5006）：kernel Work Router 生成 cp-route-api-<hex8>
# 分支，受信 publisher 以此发布——是合法造分支方，闸必须放行；变体仍拒。
# 碎片化发版（PR#5179）：auto-version.yml bot 产出 auto-version-bump-<semver> 分支,
# 是合并后版本五件套的唯一发布通道——历史上 bot PR 全死在本闸,必须放行;变体仍拒。
assert_pass "auto-version bot 分支" "auto-version-bump-1.274.0"
assert_fail "auto-version 非语义版" "auto-version-bump-latest"
assert_fail "auto-version 带尾巴"   "auto-version-bump-1.274.0-evil"

assert_pass "kernel 受信分支"     "cp-route-api-57334245"
assert_pass "kernel 受信分支2"    "cp-route-api-9da20638"
assert_fail "kernel 格式过短"     "cp-route-api-1234"
assert_fail "kernel 格式非hex"    "cp-route-api-zzzzzzzz"
assert_fail "kernel 格式带尾巴"   "cp-route-api-57334245-evil"
assert_fail "随意命名分支"        "random-feature-branch"
assert_fail "feature/* 分支"      "feature/something"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
