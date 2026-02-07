#!/bin/bash
set -euo pipefail

# brain-status.sh 功能测试
# 验证脚本能正常执行各种选项

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_STATUS="$SCRIPT_DIR/brain-status.sh"

echo "🧪 测试 brain-status.sh"
echo ""

# Test 1: 检查脚本可执行
echo "Test 1: 检查脚本可执行"
if [[ -x "$BRAIN_STATUS" ]]; then
    echo "  ✅ 脚本可执行"
else
    echo "  ❌ 脚本不可执行"
    exit 1
fi
echo ""

# Test 2: --help 选项
echo "Test 2: --help 选项"
if "$BRAIN_STATUS" --help | grep -q "Usage:"; then
    echo "  ✅ --help 输出正确"
else
    echo "  ❌ --help 输出不正确"
    exit 1
fi
echo ""

# Test 3: Brain API 可用性检查（如果 Brain 运行中）
echo "Test 3: Brain API 检查"
if curl -sf http://localhost:5221/api/brain/health > /dev/null 2>&1; then
    echo "  ✅ Brain API 可用，继续功能测试"

    # Test 4: 默认输出
    echo ""
    echo "Test 4: 默认输出（完整状态）"
    if timeout 5 "$BRAIN_STATUS" | grep -q "Cecelia Brain 状态"; then
        echo "  ✅ 默认输出包含标题"
    else
        echo "  ❌ 默认输出不正确"
        exit 1
    fi

    # Test 5: --okr 选项
    echo ""
    echo "Test 5: --okr 选项"
    if "$BRAIN_STATUS" --okr | grep -q "当前聚焦"; then
        echo "  ✅ --okr 输出正确"
    else
        echo "  ❌ --okr 输出不正确"
        exit 1
    fi

    # Test 6: --tasks 选项
    echo ""
    echo "Test 6: --tasks 选项"
    if "$BRAIN_STATUS" --tasks | grep -q "任务队列"; then
        echo "  ✅ --tasks 输出正确"
    else
        echo "  ❌ --tasks 输出不正确"
        exit 1
    fi
else
    echo "  ⚠️  Brain API 不可用，跳过功能测试"
    echo "  (仅验证脚本基本功能)"
fi

echo ""
echo "✅ 所有测试通过"
