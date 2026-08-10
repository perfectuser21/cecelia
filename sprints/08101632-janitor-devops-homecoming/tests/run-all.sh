#!/usr/bin/env bash
# 合同测试套件入口 — janitor-devops-homecoming
# 运行所有 BEHAVIOR 单元测试和 E2E 验收
# 使用方式: bash sprints/08101632-janitor-devops-homecoming/tests/run-all.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

SUITE_DIR="sprints/08101632-janitor-devops-homecoming/tests"
TOTAL_PASS=0
TOTAL_FAIL=0

run_test() {
  local name="$1"
  local script="$SUITE_DIR/$2"
  echo ""
  echo "══════════════════════════════════════════"
  echo "运行: $name"
  echo "══════════════════════════════════════════"
  if bash "$script"; then
    TOTAL_PASS=$((TOTAL_PASS+1))
    echo "  → 套件通过"
  else
    TOTAL_FAIL=$((TOTAL_FAIL+1))
    echo "  → 套件失败"
  fi
}

run_test "BEHAVIOR-01: 步骤8 branch-gc.sh 移除" "test-step8-branch.sh"
run_test "BEHAVIOR-02A: 步骤9 孤儿 worktree 识别" "test-step9-orphan-worktree.sh"
run_test "BEHAVIOR-02B: 步骤9 Guard A 三查" "test-step9-guard-a.sh"
run_test "BEHAVIOR-03: FAIL 显式化" "test-fail-explicit.sh"
run_test "BEHAVIOR-04: Brain 告警 description" "test-brain-alert.sh"
run_test "BEHAVIOR-06: 台账 ledger.csv" "test-ledger.sh"
run_test "BEHAVIOR-07: 死化石目录删除" "test-fossil-deleted.sh"
run_test "E2E 验收全套" "e2e-acceptance.sh"

echo ""
echo "════════════════════════════════════════════════"
echo "合同测试总结: $TOTAL_PASS 套件通过 / $TOTAL_FAIL 套件失败"
echo "════════════════════════════════════════════════"
[ "$TOTAL_FAIL" -eq 0 ] && exit 0 || exit 1
