#!/bin/bash
# 运行所有质量系统元测试
# 用法：bash tests/quality-system/run-all.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FAILED=0
PASSED=0

run_test() {
  local name="$1"
  local script="$2"
  echo "▶ 运行: $name"
  if bash "$script"; then
    echo "  ✅ PASS"
    PASSED=$((PASSED + 1))
  else
    echo "  ❌ FAIL"
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  质量系统元测试 (Quality System Meta Tests)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

run_test "PRD格式检查 (check-prd.sh)" "$SCRIPT_DIR/test-check-prd.sh"
run_test "Cleanup门禁检查 (cleanup-check)" "$SCRIPT_DIR/test-cleanup-check.sh"
run_test "DoD映射检查 (check-dod-mapping.cjs)" "$SCRIPT_DIR/test-check-dod-mapping.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  结果: $PASSED 通过 / $FAILED 失败"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAILED" -eq 0 ] && exit 0 || exit 1
