#!/usr/bin/env bash
#
# setup-branch-protection.test.sh - 测试 setup-branch-protection.sh 的错误处理
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  setup-branch-protection.sh 错误处理测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PASSED=0
FAILED=0

# 测试 1: 检查脚本中不再包含 || true（错误吞噬）
echo "测试 1: 检查脚本不再吞噬错误"
if grep -q "enforce_admins.*|| true" "$PROJECT_ROOT/scripts/setup-branch-protection.sh"; then
    echo "  ❌ 失败: 脚本仍然使用 || true 吞噬 enforce_admins 错误"
    FAILED=$((FAILED + 1))
else
    echo "  ✅ 通过: 脚本已移除 || true"
    PASSED=$((PASSED + 1))
fi

# 测试 2: 检查脚本使用 if-else 判断
echo ""
echo "测试 2: 检查脚本使用 if-else 判断 API 调用结果"
if grep -A 5 "gh api.*enforce_admins" "$PROJECT_ROOT/scripts/setup-branch-protection.sh" | grep -q "else"; then
    echo "  ✅ 通过: 脚本使用 if-else 判断"
    PASSED=$((PASSED + 1))
else
    echo "  ❌ 失败: 脚本未使用 if-else 判断"
    FAILED=$((FAILED + 1))
fi

# 测试 3: 检查脚本在失败时返回错误码
echo ""
echo "测试 3: 检查脚本在失败时返回错误码"
if grep -A 5 "gh api.*enforce_admins" "$PROJECT_ROOT/scripts/setup-branch-protection.sh" | grep -q "return 1"; then
    echo "  ✅ 通过: 脚本在失败时返回错误码"
    PASSED=$((PASSED + 1))
else
    echo "  ❌ 失败: 脚本未在失败时返回错误码"
    FAILED=$((FAILED + 1))
fi

# 测试 4: 检查脚本在失败时显示错误消息
echo ""
echo "测试 4: 检查脚本在失败时显示错误消息"
if grep -A 5 "gh api.*enforce_admins" "$PROJECT_ROOT/scripts/setup-branch-protection.sh" | grep -q "设置失败"; then
    echo "  ✅ 通过: 脚本在失败时显示错误消息"
    PASSED=$((PASSED + 1))
else
    echo "  ❌ 失败: 脚本未在失败时显示错误消息"
    FAILED=$((FAILED + 1))
fi

# 总结
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  测试结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  通过: $PASSED"
echo "  失败: $FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
