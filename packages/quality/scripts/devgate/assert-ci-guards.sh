#!/bin/bash
# assert-ci-guards.sh - 防篡改哨兵
#
# 验证 CI 守门没有被移除：
#   - coverage:rci 检查仍然存在
#   - version-check 检查仍然存在
#   - DevGate 检查仍然存在
#
# 用法：
#   bash scripts/devgate/assert-ci-guards.sh
#
# 退出码：
#   0: 所有守门都存在
#   1: 有守门被移除

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
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

# Guard 1: coverage:rci / scan-rci-coverage
echo "  [Guard 1] RCI 覆盖率检查"
if grep -q "scan-rci-coverage" "$CI_FILE"; then
    echo "    ✅ scan-rci-coverage 存在于 CI"
else
    echo "    ❌ scan-rci-coverage 不存在于 CI"
    echo "       守门被移除! 请恢复 DevGate 检查中的 coverage:rci"
    FAILED=1
fi

# Guard 2: version-check job
echo ""
echo "  [Guard 2] 版本号检查"
if grep -q "version-check:" "$CI_FILE"; then
    echo "    ✅ version-check job 存在"
else
    echo "    ❌ version-check job 不存在"
    echo "       守门被移除! 请恢复 version-check job"
    FAILED=1
fi

# Guard 3: DevGate checks step
echo ""
echo "  [Guard 3] DevGate 检查"
if grep -q "DevGate checks" "$CI_FILE"; then
    echo "    ✅ DevGate checks step 存在"
else
    echo "    ❌ DevGate checks step 不存在"
    echo "       守门被移除! 请恢复 DevGate checks step"
    FAILED=1
fi

# Guard 4: release-check job (for PR to main)
echo ""
echo "  [Guard 4] Release 检查"
if grep -q "release-check:" "$CI_FILE"; then
    echo "    ✅ release-check job 存在"
else
    echo "    ❌ release-check job 不存在"
    echo "       守门被移除! 请恢复 release-check job"
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
