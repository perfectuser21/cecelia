#!/usr/bin/env bash
# DevGate 激活状态检查脚本
# 验证CI质量门禁机制是否正确激活

set -euo pipefail

echo "🔍 DevGate 激活状态检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查CI配置中的DevGate机制
DEVGATE_FOUND=0

echo "1. 检查CI配置文件中的DevGate机制..."
if grep -r "check-dod-mapping\|devgate" .github/workflows/ >/dev/null 2>&1; then
    echo "   ✅ CI配置包含DevGate检查"
    DEVGATE_FOUND=$((DEVGATE_FOUND + 1))
else
    echo "   ❌ CI配置未找到DevGate检查"
fi

echo ""
echo "2. 检查DevGate脚本文件..."
SCRIPTS_FOUND=0
for script in "check-dod-mapping.cjs" "dod-execution-gate.sh" "rci-execution-gate.sh"; do
    if [[ -f "packages/engine/scripts/devgate/$script" ]]; then
        echo "   ✅ $script 存在"
        SCRIPTS_FOUND=$((SCRIPTS_FOUND + 1))
    else
        echo "   ❌ $script 不存在"
    fi
done

echo ""
echo "3. 验证DevGate功能..."
if node packages/engine/scripts/devgate/check-dod-mapping.cjs >/dev/null 2>&1; then
    echo "   ✅ DevGate检查脚本工作正常"
    DEVGATE_FOUND=$((DEVGATE_FOUND + 1))
else
    echo "   ❌ DevGate检查脚本有问题"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 DevGate 激活状态汇总:"
echo "   CI配置: $([ $DEVGATE_FOUND -ge 2 ] && echo '激活' || echo '未激活')"
echo "   脚本文件: $SCRIPTS_FOUND/3 个存在"
echo ""

if [[ $DEVGATE_FOUND -ge 2 && $SCRIPTS_FOUND -ge 2 ]]; then
    echo "✅ DevGate 质量门禁机制已成功激活"
    exit 0
else
    echo "❌ DevGate 质量门禁机制未完全激活"
    exit 1
fi
