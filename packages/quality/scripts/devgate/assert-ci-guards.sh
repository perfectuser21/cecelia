#!/bin/bash
# assert-ci-guards.sh - 防篡改哨兵
#
# 验证当前 CI 的等价守门没有被移除：
#   - 根 regression-contract release 回归
#   - Engine/Brain 版本检查
#   - 分解后的 DevGate lint 集合
#   - 汇总门与只读 merge eligibility
#
# 用法：
#   bash scripts/devgate/assert-ci-guards.sh
#
# 退出码：
#   0: 所有守门都存在
#   1: 有守门被移除

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CI_FILE="$PROJECT_ROOT/.github/workflows/ci.yml"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CI Guards Assertion (防篡改哨兵)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ ! -f "$CI_FILE" ]]; then
    echo "❌ CI 文件不存在: $CI_FILE"
    exit 1
fi

FAILED=0

# Guard 1: 根 regression-contract release 回归
echo "  [Guard 1] Regression Contract release 回归"
if grep -q "^  core-regression:" "$CI_FILE" \
  && grep -q "run-core-regression.sh --tier release" "$CI_FILE"; then
    echo "    ✅ core-regression release gate 存在"
else
    echo "    ❌ core-regression release gate 不完整"
    FAILED=1
fi

# Guard 2: Engine + Brain 版本门
echo ""
echo "  [Guard 2] 版本号检查"
if grep -q "check-version-sync.sh" "$CI_FILE" \
  && grep -q "^  brain-version-bump-gate:" "$CI_FILE"; then
    echo "    ✅ Engine sync + Brain bump gate 存在"
else
    echo "    ❌ Engine/Brain 版本门不完整"
    FAILED=1
fi

# Guard 3: 分解后的 DevGate
echo ""
echo "  [Guard 3] DevGate 检查"
if grep -q "^  lint-tdd-commit-order:" "$CI_FILE" \
  && grep -q "^  lint-test-quality:" "$CI_FILE" \
  && grep -q "^  lint-no-fake-test:" "$CI_FILE" \
  && grep -q "^  lint-bypass-not-committed:" "$CI_FILE"; then
    echo "    ✅ 分解式 DevGate lint 集合存在"
else
    echo "    ❌ 分解式 DevGate lint 集合不完整"
    FAILED=1
fi

# Guard 4: 汇总门 + merge eligibility 只读
echo ""
echo "  [Guard 4] 合并授权边界"
if grep -q "^  ci-passed:" "$CI_FILE" \
  && grep -q "^  auto-merge:" "$CI_FILE" \
  && grep -q "pull-requests: read" "$CI_FILE" \
  && grep -q "Kernel merge eligibility（只读）" "$CI_FILE"; then
    echo "    ✅ ci-passed + 只读 merge eligibility 存在"
else
    echo "    ❌ 合并授权边界不完整"
    FAILED=1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAILED -eq 0 ]]; then
    echo "  ✅ 所有 CI 守门都存在"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
else
    echo "  ❌ 有守门被移除，请检查并恢复"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
