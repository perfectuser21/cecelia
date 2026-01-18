#!/usr/bin/env bash
# ZenithJoy Engine - Cleanup 脚本
# PR 合并后执行完整清理，确保不留垃圾
#
# 用法: bash skills/dev/scripts/cleanup.sh <cp-分支名> <base-分支名>
# 例如: bash skills/dev/scripts/cleanup.sh cp-20260117-fix-bug develop

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 参数
CP_BRANCH="${1:-}"
BASE_BRANCH="${2:-develop}"

if [[ -z "$CP_BRANCH" ]]; then
    echo -e "${RED}错误: 请提供 cp-* 分支名${NC}"
    echo "用法: bash cleanup.sh <cp-分支名> [base-分支名]"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧹 Cleanup 检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  CP 分支: $CP_BRANCH"
echo "  Base 分支: $BASE_BRANCH"
echo ""

FAILED=0
WARNINGS=0
CHECKOUT_FAILED=0

# ========================================
# 1. 检查当前分支
# ========================================
echo "1️⃣  检查当前分支..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" == "$CP_BRANCH" ]]; then
    echo -e "   ${YELLOW}⚠️  还在 $CP_BRANCH 分支，需要切换${NC}"
    echo "   → 切换到 $BASE_BRANCH..."
    if git checkout "$BASE_BRANCH" 2>/dev/null; then
        CURRENT_BRANCH="$BASE_BRANCH"
    else
        echo -e "   ${RED}❌ 切换失败，无法继续删除本地分支${NC}"
        FAILED=1
        CHECKOUT_FAILED=1
    fi
else
    echo -e "   ${GREEN}✅ 当前在 $CURRENT_BRANCH${NC}"
fi

# ========================================
# 2. 拉取最新代码
# ========================================
echo ""
echo "2️⃣  拉取最新代码..."
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}⚠️  跳过（checkout 失败，不在目标分支）${NC}"
elif git pull origin "$BASE_BRANCH" 2>/dev/null; then
    echo -e "   ${GREEN}✅ 已同步最新代码${NC}"
else
    echo -e "   ${YELLOW}⚠️  拉取失败，可能有冲突${NC}"
    WARNINGS=$((WARNINGS + 1))
    # 检查是否处于 MERGING 状态
    if [[ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]]; then
        echo -e "   ${RED}❌ 检测到未完成的合并，需要手动解决${NC}"
        echo -e "   → 运行 'git merge --abort' 取消合并，或手动解决冲突"
        FAILED=1
    fi
fi

# ========================================
# 3. 检查并删除本地 cp-* 分支
# ========================================
echo ""
echo "3️⃣  检查本地 cp-* 分支..."
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}⚠️  跳过（checkout 失败，无法删除当前所在分支）${NC}"
elif git branch --list "$CP_BRANCH" | grep -q "$CP_BRANCH"; then
    echo "   → 删除本地分支 $CP_BRANCH..."
    if git branch -D "$CP_BRANCH" 2>/dev/null; then
        echo -e "   ${GREEN}✅ 已删除本地分支${NC}"
    else
        echo -e "   ${RED}❌ 删除失败${NC}"
        FAILED=1
    fi
else
    echo -e "   ${GREEN}✅ 本地分支已不存在${NC}"
fi

# ========================================
# 4. 检查并删除远程 cp-* 分支
# ========================================
echo ""
echo "4️⃣  检查远程 cp-* 分支..."
if git ls-remote --heads origin "$CP_BRANCH" 2>/dev/null | grep -q "$CP_BRANCH"; then
    echo "   → 删除远程分支 $CP_BRANCH..."
    if git push origin --delete "$CP_BRANCH" 2>/dev/null; then
        echo -e "   ${GREEN}✅ 已删除远程分支${NC}"
    else
        echo -e "   ${YELLOW}⚠️  删除失败（可能已被 GitHub 自动删除）${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${GREEN}✅ 远程分支已不存在${NC}"
fi

# ========================================
# 5. 清理 git config 中的分支记录
# ========================================
echo ""
echo "5️⃣  清理 git config..."
CLEANED=false
# 清理所有可能的配置项（只清理实际使用的 key）
for CONFIG_KEY in "base-branch" "prd-confirmed" "step"; do
    if git config --get "branch.$CP_BRANCH.$CONFIG_KEY" &>/dev/null; then
        git config --unset "branch.$CP_BRANCH.$CONFIG_KEY" 2>/dev/null || true
        CLEANED=true
    fi
done
if [ "$CLEANED" = true ]; then
    echo -e "   ${GREEN}✅ 已清理 git config${NC}"
else
    echo -e "   ${GREEN}✅ 无需清理 git config${NC}"
fi

# ========================================
# 6. 删除 .project-info.json 缓存
# ========================================
echo ""
echo "6️⃣  删除 .project-info.json 缓存..."
if [[ -f ".project-info.json" ]]; then
    if rm -f ".project-info.json" 2>/dev/null; then
        echo -e "   ${GREEN}✅ 已删除 .project-info.json${NC}"
    else
        echo -e "   ${YELLOW}⚠️  删除 .project-info.json 失败${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${GREEN}✅ .project-info.json 已不存在${NC}"
fi

# ========================================
# 7. 清理 stale remote refs
# ========================================
echo ""
echo "7️⃣  清理 stale remote refs..."
PRUNED=$(git remote prune origin 2>&1 || true)
if echo "$PRUNED" | grep -q "pruning"; then
    echo -e "   ${GREEN}✅ 已清理 stale refs${NC}"
else
    echo -e "   ${GREEN}✅ 无 stale refs${NC}"
fi

# ========================================
# 8. 检查未提交的文件
# ========================================
echo ""
echo "8️⃣  检查未提交文件..."
UNCOMMITTED=$(git status --porcelain 2>/dev/null | grep -v "node_modules" | head -5 || true)
if [[ -n "$UNCOMMITTED" ]]; then
    echo -e "   ${YELLOW}⚠️  有未提交的文件:${NC}"
    echo "$UNCOMMITTED" | sed 's/^/      /'
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "   ${GREEN}✅ 无未提交文件${NC}"
fi

# ========================================
# 9. 删除 .quality-report.json（防止残留影响下次）
# ========================================
echo ""
echo "9️⃣  删除 .quality-report.json..."
if [[ -f ".quality-report.json" ]]; then
    if rm -f ".quality-report.json" 2>/dev/null; then
        echo -e "   ${GREEN}✅ 已删除 .quality-report.json${NC}"
    else
        echo -e "   ${YELLOW}⚠️  删除 .quality-report.json 失败${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${GREEN}✅ .quality-report.json 已不存在${NC}"
fi

# ========================================
# 10. 检查是否有其他 cp-* 分支遗留
# ========================================
echo ""
echo "🔟 检查其他遗留的 cp-* 分支..."
OTHER_CP=$(git branch --list "cp-*" 2>/dev/null | grep -v "^\*" || true)
if [[ -n "$OTHER_CP" ]]; then
    echo -e "   ${YELLOW}⚠️  发现其他 cp-* 分支:${NC}"
    echo "$OTHER_CP" | sed 's/^/      /'
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "   ${GREEN}✅ 无其他 cp-* 分支${NC}"
fi

# ========================================
# 11. 设置 step=11（标记 cleanup 完成）
# ========================================
echo ""
echo "1️⃣1️⃣ 设置 step=11..."
# 注意：此时 git config 可能已被清理，所以这里是为外部调用者记录状态
# 如果分支已删除，则不再需要设置（分支和 config 都已清理）
if git rev-parse --abbrev-ref HEAD 2>/dev/null | grep -q "^$CP_BRANCH$"; then
    # 如果仍在 cp 分支（不应该发生），尝试设置
    git config "branch.$CP_BRANCH.step" 11 2>/dev/null || true
    echo -e "   ${YELLOW}⚠️  仍在 cp 分支，已设置 step=11${NC}"
else
    echo -e "   ${GREEN}✅ step=11（cleanup 完成）${NC}"
fi

# ========================================
# 总结
# ========================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAILED -gt 0 ]]; then
    echo -e "  ${RED}❌ Cleanup 失败 ($FAILED 个错误)${NC}"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠️  Cleanup 完成 ($WARNINGS 个警告)${NC}"
else
    echo -e "  ${GREEN}✅ Cleanup 完成，无遗留${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
