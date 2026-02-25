#!/usr/bin/env bash
set -euo pipefail

# auto-generate-views.sh
# 自动检测并生成派生视图
#
# 用途：防止 feature-registry.yml 更新后忘记生成派生视图
# 调用时机：
#   - Pre-commit Hook（推荐）
#   - Step 7 (Quality) 中自动检查

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Auto-Generate Views"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查 feature-registry.yml 是否存在
if [[ ! -f "features/feature-registry.yml" ]]; then
  echo "⚠️ features/feature-registry.yml 不存在，跳过"
  exit 0
fi

# 检查是否有 staged 的 feature-registry.yml 变更
REGISTRY_CHANGED=false

if git diff --cached --name-only | grep -q "features/feature-registry.yml"; then
  echo "✅ 检测到 feature-registry.yml 已暂存变更"
  REGISTRY_CHANGED=true
elif git diff --name-only | grep -q "features/feature-registry.yml"; then
  echo "✅ 检测到 feature-registry.yml 未暂存变更"
  REGISTRY_CHANGED=true
fi

if [[ "$REGISTRY_CHANGED" == "false" ]]; then
  echo "feature-registry.yml 无变更，跳过"
  exit 0
fi

echo ""
echo "自动生成派生视图..."
echo ""

# 运行生成脚本
if bash scripts/generate-path-views.sh; then
  echo ""
  echo "✅ 派生视图已生成"

  # 自动暂存生成的文件
  if git add docs/paths/*.md 2>/dev/null; then
    echo "✅ 派生视图已暂存"
  fi

  echo ""
  echo "生成的文件："
  git diff --cached --name-only | grep "docs/paths/" || true

else
  echo ""
  echo "❌ 生成失败"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
