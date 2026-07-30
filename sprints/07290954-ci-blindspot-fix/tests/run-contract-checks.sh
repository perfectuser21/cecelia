#!/usr/bin/env bash
# sprints/07290954-ci-blindspot-fix/tests/run-contract-checks.sh
# 契约验收骨架：本地手动验证脚本（对应 contract-dod.md 静态断言检查表）
# 用法：bash sprints/07290954-ci-blindspot-fix/tests/run-contract-checks.sh

set -euo pipefail

CI_YML=".github/workflows/ci.yml"
PASS=0
FAIL=0

pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }

echo "=== CI Blindspot Contract Checks ==="
echo "target: $CI_YML"
echo ""

# ── 断言 1：changes job 含 push 事件判断逻辑 ──────────────────────
CHANGES_BLOCK=$(awk '/^  changes:/{found=1} found && /^  [a-z]/ && !/^  changes:/{exit} found{print}' "$CI_YML")
if echo "$CHANGES_BLOCK" | grep -qE 'event_name.*(==|!=).*push'; then
  pass "ASSERT-1: changes job 含 push 事件短路逻辑"
else
  fail "ASSERT-1: changes job 缺少 push 事件短路逻辑（event_name == push）"
fi

# ── 断言 2：ci.yml 含 fleet-worker shell 测试 glob 行 ─────────────
if grep -qF 'for t in packages/brain/scripts/fleet-worker/*.test.sh' "$CI_YML"; then
  pass "ASSERT-2: ci.yml 含 fleet-worker *.test.sh glob"
else
  fail "ASSERT-2: ci.yml 缺少 fleet-worker *.test.sh glob（brain-tests-shell job 未接入）"
fi

# ── 断言 3：ci-passed needs 数组含 brain-tests-shell ──────────────
CI_PASSED_BLOCK=$(awk '/^  ci-passed:/{found=1} found && /^  [a-z]/ && !/^  ci-passed:/{exit} found{print}' "$CI_YML")
if echo "$CI_PASSED_BLOCK" | grep -q 'brain-tests-shell'; then
  pass "ASSERT-3: ci-passed needs 含 brain-tests-shell"
else
  fail "ASSERT-3: ci-passed needs 缺少 brain-tests-shell"
fi

echo ""
echo "=== 结果 ==="
echo "PASS=$PASS FAIL=$FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo "CONTRACT FAIL（期望 Commit-2 后全绿）"
  exit 1
else
  echo "CONTRACT PASS"
  exit 0
fi
