#!/usr/bin/env bash
# packages/engine/tests/integrity/ci-blindspot-contract.test.sh
#
# CI 两处失明修复 — 静态契约断言
# 由 engine-tests-shell job 的 "Run integrity meta-tests" step 自动接线（glob 扫描）
#
# Commit-1（TDD 红）阶段：ci.yml 未修复时，预期 PASS=0 FAIL=3
# Commit-2（TDD 绿）阶段：ci.yml 修复后，预期 PASS=3 FAIL=0
#
# 用法：bash packages/engine/tests/integrity/ci-blindspot-contract.test.sh

set -euo pipefail

CI_YML=".github/workflows/ci.yml"
PASS=0
FAIL=0

_pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

echo "[ci-blindspot-contract] 开始静态契约断言..."

if [[ ! -f "$CI_YML" ]]; then
  echo "[ci-blindspot-contract] ERROR: $CI_YML 不存在，中止"
  exit 1
fi

# ── 断言 1：changes job 内含 push 事件分支判断 ───────────────────────────────
# 提取 changes: job 到下一顶层 job 之间的内容，检测 event_name == push 或等效逻辑
CHANGES_BLOCK=$(awk '
  /^  changes:/ { found=1 }
  found && /^  [a-z]/ && !/^  changes:/ { exit }
  found { print }
' "$CI_YML")

if echo "$CHANGES_BLOCK" | grep -qE 'event_name.*(==|!=).*push'; then
  _pass "ASSERT-1: changes job 含 push 事件短路逻辑（event_name == push）"
else
  _fail "ASSERT-1: changes job 缺少 push 事件短路逻辑 — push 到 main 时 diff 恒空，下游全 skip（失明点①）"
fi

# ── 断言 2：ci.yml 存在运行 fleet-worker 测试的 glob 行 ──────────────────────
# 必须在某个 job 的 run: 块中含有对应 glob，确保孤儿测试被执行
if grep -qF 'for t in packages/brain/scripts/fleet-worker/*.test.sh' "$CI_YML"; then
  _pass "ASSERT-2: ci.yml 含 fleet-worker *.test.sh glob（失明点②已修复）"
else
  _fail "ASSERT-2: ci.yml 缺少 fleet-worker *.test.sh glob — 5 个 fleet-worker 测试为孤儿，从未被 CI 执行（失明点②）"
fi

# ── 断言 3：ci-passed job 的 needs 数组含 brain-tests-shell ─────────────────
# 提取 ci-passed: job 块，检测 brain-tests-shell 出现在该块内
CI_PASSED_BLOCK=$(awk '
  /^  ci-passed:/ { found=1 }
  found && /^  [a-z]/ && !/^  ci-passed:/ { exit }
  found { print }
' "$CI_YML")

if echo "$CI_PASSED_BLOCK" | grep -q 'brain-tests-shell'; then
  _pass "ASSERT-3: ci-passed needs 数组含 brain-tests-shell（已列为必过项）"
else
  _fail "ASSERT-3: ci-passed needs 缺少 brain-tests-shell — fleet-worker 测试即使失败也不阻断合并（失明点②）"
fi

# ── 结果汇总 ────────────────────────────────────────────────────────────────
echo ""
echo "[ci-blindspot-contract] PASS=$PASS FAIL=$FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  echo "[ci-blindspot-contract] FAIL（期望 Commit-2 后三条全绿）"
  exit 1
else
  echo "[ci-blindspot-contract] PASS — 所有契约断言满足"
  exit 0
fi
