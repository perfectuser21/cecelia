#!/usr/bin/env bash
set -euo pipefail

# cleanup-prd-dod.sh
# 清理 develop/main 分支上的 PRD/DoD 文件
# 用途：在 CI 后自动清理 squash merge 带来的残留文件

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cleanup PRD/DoD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "当前分支: $CURRENT_BRANCH"
echo ""

# 只在 develop 或 main 分支执行
if [[ "$CURRENT_BRANCH" != "develop" && "$CURRENT_BRANCH" != "main" ]]; then
    echo "⏭️  跳过：只清理 develop/main 分支"
    exit 0
fi

# 检查是否有 PRD/DoD 文件
HAS_PRD=false
HAS_DOD=false

if [[ -f ".prd.md" ]]; then
    HAS_PRD=true
fi

if [[ -f ".dod.md" ]]; then
    HAS_DOD=true
fi

if [[ "$HAS_PRD" == "false" && "$HAS_DOD" == "false" ]]; then
    echo "✅ 无需清理（没有 PRD/DoD 文件）"
    exit 0
fi

# 执行清理
echo "🧹 发现残留文件，开始清理..."
echo ""

CLEANED=()

if [[ "$HAS_PRD" == "true" ]]; then
    rm -f .prd.md
    CLEANED+=(".prd.md")
    echo "  ✅ 已删除 .prd.md"
fi

if [[ "$HAS_DOD" == "true" ]]; then
    rm -f .dod.md
    CLEANED+=(".dod.md")
    echo "  ✅ 已删除 .dod.md"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 清理完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "已清理文件:"
for file in "${CLEANED[@]}"; do
    echo "  - $file"
done
echo ""
echo "说明: 这些文件应该只存在于功能分支（cp-*, feature/*）"
echo "     squash merge 会把它们带到 develop/main"
echo "     此脚本自动清理这些残留"
echo ""
