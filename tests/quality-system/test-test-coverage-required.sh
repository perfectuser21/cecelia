#!/bin/bash
# 元测试：验证 test-coverage-required CI job 的核心检测逻辑
# 场景1：变更文件列表包含 .test.ts 文件 → 应检测到（通过）
# 场景2：变更文件列表只有源码文件，无测试文件 → 应检测不到（失败）
# 场景3：变更文件包含 tests/ 目录下文件 → 应检测到（通过）
# 场景4：变更文件包含 __tests__/ 目录下文件 → 应检测到（通过）

PASS_COUNT=0
FAIL_COUNT=0

# 测试文件模式（与 ci-l3-code.yml 中的 TEST_PATTERNS 保持一致）
TEST_PATTERNS="\.test\.ts$|\.spec\.ts$|\.test\.js$|\.spec\.js$|\.test\.cjs$|\.spec\.cjs$|\.test\.mjs$|\.spec\.mjs$|^tests/|/__tests__/|_test\.py$|^test_.*\.sh$"

check_test() {
  local test_name="$1"
  local changed_files="$2"
  local should_find="$3"  # "found" or "not-found"

  local detected
  detected=$(echo "$changed_files" | grep -E "$TEST_PATTERNS" || true)

  if [ "$should_find" = "found" ]; then
    if [ -n "$detected" ]; then
      echo "  ✅ $test_name"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      echo "  ❌ $test_name — 期望找到测试文件，但未找到"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    if [ -z "$detected" ]; then
      echo "  ✅ $test_name"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      echo "  ❌ $test_name — 期望未找到测试文件，但找到了: $detected"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  test-coverage-required 逻辑验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 场景1：有 .test.ts 文件
check_test "场景1: .test.ts 文件被检测到" \
  "src/foo.ts
src/foo.test.ts
package.json" \
  "found"

# 场景2：只有源码文件
check_test "场景2: 纯源码文件不被检测为测试" \
  "src/foo.ts
src/bar.ts
package.json" \
  "not-found"

# 场景3：tests/ 目录
check_test "场景3: tests/ 目录文件被检测到" \
  "src/foo.ts
tests/foo.integration.ts" \
  "found"

# 场景4：__tests__/ 目录
check_test "场景4: __tests__/ 目录文件被检测到" \
  "src/foo.ts
src/__tests__/foo.unit.ts" \
  "found"

# 场景5：.spec.js 文件
check_test "场景5: .spec.js 文件被检测到" \
  "src/component.js
src/component.spec.js" \
  "found"

# 场景6：.test.cjs 文件
check_test "场景6: .test.cjs 文件被检测到" \
  "scripts/worker.cjs
scripts/__tests__/worker.test.cjs" \
  "found"

# 场景7：test_*.sh 文件
check_test "场景7: test_*.sh 文件被检测到" \
  "scripts/deploy.sh
tests/test_deploy.sh" \
  "found"

# 场景8：配置文件不算测试
check_test "场景8: CI yaml 文件不被误判为测试" \
  ".github/workflows/ci-l3-code.yml
packages/engine/VERSION" \
  "not-found"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  结果: $PASS_COUNT 通过, $FAIL_COUNT 失败"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
