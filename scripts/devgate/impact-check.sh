#!/bin/bash
set -euo pipefail

# ============================================================================
# Impact Check - 能力变更强制登记
# ============================================================================
# 目标: 改了核心能力文件，必须同时更新能力注册表
# 前向一致: 改能力→必须登记 | 改登记→允许（不要求改能力）
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Impact Check: 能力变更登记检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 获取基础分支（CI 中使用 BASE_REF 环境变量）
BASE_REF="${BASE_REF:-origin/develop}"

# 核心能力文件路径
# 注意：features/ 不包含在内，因为 feature-registry.yml 是被检查的目标，不是源
CORE_PATHS=(
  "hooks/"
  "skills/"
  "scripts/detect-phase.sh"
  "scripts/qa-with-gate.sh"
)

# 获取改动的文件列表
CHANGED_FILES=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || echo "")

if [[ -z "$CHANGED_FILES" ]]; then
  echo "⚠️  无法获取改动文件列表，跳过检查"
  exit 0
fi

# 检查是否改动了核心能力文件
CORE_CHANGED=false
for path in "${CORE_PATHS[@]}"; do
  if echo "$CHANGED_FILES" | grep -q "^$path"; then
    CORE_CHANGED=true
    echo "✓ 检测到核心能力文件改动: $path"
  fi
done

# 检查是否改动了 feature-registry.yml
REGISTRY_CHANGED=false
if echo "$CHANGED_FILES" | grep -q "^features/feature-registry.yml$"; then
  REGISTRY_CHANGED=true
  echo "✓ feature-registry.yml 已更新"
fi

echo ""

# 前向一致性检查
if [[ "$CORE_CHANGED" == "true" && "$REGISTRY_CHANGED" == "false" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ Impact Check 失败"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "核心能力文件已变更，但 feature-registry.yml 未更新！"
  echo ""
  echo "修复方法："
  echo "  1. 编辑 features/feature-registry.yml"
  echo "  2. 更新对应 feature 的 version 和 updated 字段"
  echo "  3. 或添加新的 feature 条目"
  echo ""
  exit 1
elif [[ "$REGISTRY_CHANGED" == "true" && "$CORE_CHANGED" == "false" ]]; then
  echo "✅ 仅更新 registry（文档更新），允许通过"
elif [[ "$CORE_CHANGED" == "true" && "$REGISTRY_CHANGED" == "true" ]]; then
  echo "✅ 核心能力和 registry 同时更新，通过"
else
  echo "ℹ️  未改动核心能力文件，跳过检查"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Impact Check 通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
