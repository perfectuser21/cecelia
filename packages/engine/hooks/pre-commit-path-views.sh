#!/usr/bin/env bash
# ============================================================================
# pre-commit-path-views.sh
#
# Pre-commit hook：检测 feature-registry.yml 变更时自动运行 generate-path-views.sh
#
# 作用：消除"改了 feature-registry.yml 但忘记跑 generate-path-views.sh"导致的
#       CI L2 Contract Drift 失败（占历史 CI 失败的 ~25%）
#
# 使用方式（在 .git/hooks/pre-commit 中调用）：
#   bash packages/engine/hooks/pre-commit-path-views.sh
#
# 返回码：
#   0 - 无变更或已成功重新生成
#   1 - generate-path-views.sh 失败
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REGISTRY_FILE="packages/engine/features/feature-registry.yml"
GENERATE_SCRIPT="$ENGINE_ROOT/scripts/generate-path-views.sh"

# 检测 feature-registry.yml 是否在本次提交中被修改
# 使用 git diff --cached 检测暂存区变更
if ! git diff --cached --name-only 2>/dev/null | grep -q "^$REGISTRY_FILE$"; then
  # feature-registry.yml 未变更，跳过
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  检测到 feature-registry.yml 变更"
echo "  自动运行 generate-path-views.sh..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查 generate-path-views.sh 是否存在
if [[ ! -f "$GENERATE_SCRIPT" ]]; then
  echo "❌ 找不到 $GENERATE_SCRIPT"
  echo "   请检查 Engine 路径是否正确"
  exit 1
fi

# 检查 yq 是否安装
if ! command -v yq &>/dev/null; then
  echo "⚠️  yq 未安装，跳过自动生成（CI 会检测）"
  echo "   安装：brew install yq"
  exit 0
fi

# 运行 generate-path-views.sh（从 packages/engine 目录）
if (cd "$ENGINE_ROOT" && bash scripts/generate-path-views.sh); then
  echo "✅ path views 已重新生成"

  # 将生成的文件自动加入暂存区
  git add packages/engine/docs/paths/ 2>/dev/null || true
  echo "✅ docs/paths/ 已自动 git add"
else
  echo "❌ generate-path-views.sh 失败"
  echo "   请手动运行: cd packages/engine && bash scripts/generate-path-views.sh"
  exit 1
fi

exit 0
