#!/usr/bin/env bash
# ZenithJoy Engine - Cleanup 脚本
# v1.3: 使用 mktemp 替代硬编码 /tmp，修复 MERGE_HEAD 路径
# v1.2: 报告生成错误记录到日志而非吞掉
# v1.1: 自动检测 base 分支（从 git config 读取）
# PR 合并后执行完整清理，确保不留垃圾
#
# 用法: bash skills/dev/scripts/cleanup.sh <cp-分支名> [base-分支名]
# 例如: bash skills/dev/scripts/cleanup.sh cp-20260117-fix-bug develop

set -euo pipefail

# L2 fix: 临时文件清理 trap
TEMP_FILES=()
cleanup_temp() {
    for f in "${TEMP_FILES[@]}"; do
        rm -f "$f" 2>/dev/null || true
    done
}
trap cleanup_temp EXIT

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 参数
CP_BRANCH="${1:-}"
# v1.1: 优先使用参数，其次从 git config 读取，最后 fallback 到 develop
BASE_BRANCH="${2:-$(git config "branch.$CP_BRANCH.base-branch" 2>/dev/null || echo "develop")}"

if [[ -z "$CP_BRANCH" ]]; then
    echo -e "${RED}错误: 请提供 cp-* 分支名${NC}"
    echo "用法: bash cleanup.sh <cp-分支名> [base-分支名]"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cleanup 检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  CP 分支: $CP_BRANCH"
echo "  Base 分支: $BASE_BRANCH"
echo ""

# ========================================
# 0. 生成任务报告（在 cleanup 前）
# ========================================
echo "0. 生成任务报告..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_ERROR_LOG=$(mktemp)
TEMP_FILES+=("$REPORT_ERROR_LOG")  # L2 fix: 注册到临时文件列表
if [[ -f "$SCRIPT_DIR/generate-report.sh" ]]; then
    # v1.2: 记录错误到日志而非吞掉
    if bash "$SCRIPT_DIR/generate-report.sh" "$CP_BRANCH" "$BASE_BRANCH" "$(pwd)" 2>"$REPORT_ERROR_LOG"; then
        echo -e "   ${GREEN}[OK] 报告已保存到 .dev-runs/${NC}"
    else
        echo -e "   ${YELLOW}[WARN] 报告生成失败，继续 cleanup${NC}"
        if [[ -s "$REPORT_ERROR_LOG" ]]; then
            echo -e "   ${YELLOW}错误日志: $REPORT_ERROR_LOG${NC}"
        fi
    fi
else
    echo -e "   ${YELLOW}[WARN] generate-report.sh 不存在，跳过${NC}"
fi
echo ""

FAILED=0
WARNINGS=0
CHECKOUT_FAILED=0

# ========================================
# 1. 检查当前分支
# ========================================
echo "[1]  检查当前分支..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" == "$CP_BRANCH" ]]; then
    echo -e "   ${YELLOW}[WARN]  还在 $CP_BRANCH 分支，需要切换${NC}"
    echo "   → 切换到 $BASE_BRANCH..."
    if git checkout "$BASE_BRANCH" 2>/dev/null; then
        CURRENT_BRANCH="$BASE_BRANCH"
    else
        echo -e "   ${RED}[FAIL] 切换失败，无法继续删除本地分支${NC}"
        FAILED=1
        CHECKOUT_FAILED=1
    fi
else
    echo -e "   ${GREEN}[OK] 当前在 $CURRENT_BRANCH${NC}"
fi

# ========================================
# 2. 拉取最新代码
# ========================================
echo ""
echo "[2]  拉取最新代码..."
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}[WARN]  跳过（checkout 失败，不在目标分支）${NC}"
elif git pull origin "$BASE_BRANCH" 2>/dev/null; then
    echo -e "   ${GREEN}[OK] 已同步最新代码${NC}"
else
    echo -e "   ${YELLOW}[WARN]  拉取失败，可能有冲突${NC}"
    WARNINGS=$((WARNINGS + 1))
    # L2 fix: 检查是否处于 MERGING 状态，处理 rev-parse 错误
    MERGE_HEAD_PATH=$(git rev-parse --git-path MERGE_HEAD 2>/dev/null || echo "")
    if [[ -n "$MERGE_HEAD_PATH" && -f "$MERGE_HEAD_PATH" ]]; then
        echo -e "   ${RED}[FAIL] 检测到未完成的合并，需要手动解决${NC}"
        echo -e "   → 运行 'git merge --abort' 取消合并，或手动解决冲突"
        FAILED=1
    fi
fi

# ========================================
# 3. 检查并删除本地 cp-* 分支
# ========================================
echo ""
echo "[3]  检查本地 cp-* 分支..."
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}[WARN]  跳过（checkout 失败，无法删除当前所在分支）${NC}"
elif git branch --list "$CP_BRANCH" | grep -q "$CP_BRANCH"; then
    echo "   → 删除本地分支 $CP_BRANCH..."
    if git branch -D "$CP_BRANCH" 2>/dev/null; then
        echo -e "   ${GREEN}[OK] 已删除本地分支${NC}"
    else
        echo -e "   ${RED}[FAIL] 删除失败${NC}"
        FAILED=1
    fi
else
    echo -e "   ${GREEN}[OK] 本地分支已不存在${NC}"
fi

# ========================================
# 4. 检查并删除远程 cp-* 分支
# ========================================
echo ""
echo "[4]  检查远程 cp-* 分支..."
if git ls-remote --heads origin "$CP_BRANCH" 2>/dev/null | grep -q "$CP_BRANCH"; then
    echo "   → 删除远程分支 $CP_BRANCH..."
    if git push origin --delete "$CP_BRANCH" 2>/dev/null; then
        echo -e "   ${GREEN}[OK] 已删除远程分支${NC}"
    else
        echo -e "   ${YELLOW}[WARN]  删除失败（可能已被 GitHub 自动删除）${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${GREEN}[OK] 远程分支已不存在${NC}"
fi

# ========================================
# 5. 清理 git config 中的分支记录
# ========================================
echo ""
echo "[5]  清理 git config..."
CLEANED=false
# 清理所有可能的配置项（包括遗留的和当前使用的）
for CONFIG_KEY in "base-branch" "prd-confirmed" "step" "is-test"; do
    if git config --get "branch.$CP_BRANCH.$CONFIG_KEY" &>/dev/null; then
        git config --unset "branch.$CP_BRANCH.$CONFIG_KEY" 2>/dev/null || true
        CLEANED=true
    fi
done
if [ "$CLEANED" = true ]; then
    echo -e "   ${GREEN}[OK] 已清理 git config${NC}"
else
    echo -e "   ${GREEN}[OK] 无需清理 git config${NC}"
fi

# ========================================
# 6. 清理 stale remote refs
# ========================================
echo ""
echo "[6]  清理 stale remote refs..."
PRUNED=$(git remote prune origin 2>&1 || true)
if echo "$PRUNED" | grep -q "pruning"; then
    echo -e "   ${GREEN}[OK] 已清理 stale refs${NC}"
else
    echo -e "   ${GREEN}[OK] 无 stale refs${NC}"
fi

# ========================================
# 7. 检查未提交的文件
# ========================================
echo ""
echo "[7]  检查未提交文件..."
UNCOMMITTED=$(git status --porcelain 2>/dev/null | grep -v "node_modules" | head -5 || true)
if [[ -n "$UNCOMMITTED" ]]; then
    echo -e "   ${YELLOW}[WARN]  有未提交的文件:${NC}"
    echo "$UNCOMMITTED" | sed 's/^/      /'
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "   ${GREEN}[OK] 无未提交文件${NC}"
fi

# ========================================
# 8. 删除 .quality-report.json（防止残留影响下次）
# ========================================
echo ""
echo "[8]  删除 .quality-report.json..."
if [[ -f ".quality-report.json" ]]; then
    if rm -f ".quality-report.json" 2>/dev/null; then
        echo -e "   ${GREEN}[OK] 已删除 .quality-report.json${NC}"
    else
        echo -e "   ${YELLOW}[WARN]  删除 .quality-report.json 失败${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${GREEN}[OK] .quality-report.json 已不存在${NC}"
fi

# ========================================
# 9. 检查是否有其他 cp-* 分支遗留
# ========================================
echo ""
echo "[9]  检查其他遗留的 cp-* 分支..."
OTHER_CP=$(git branch --list "cp-*" 2>/dev/null | grep -v "^\*" || true)
if [[ -n "$OTHER_CP" ]]; then
    echo -e "   ${YELLOW}[WARN]  发现其他 cp-* 分支:${NC}"
    echo "$OTHER_CP" | sed 's/^/      /'
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "   ${GREEN}[OK] 无其他 cp-* 分支${NC}"
fi

# ========================================
# 10. Cleanup 完成（v8: 不再使用步骤状态机）
# ========================================
echo ""
echo "[10] Cleanup 完成..."
echo -e "   ${GREEN}[OK] 所有清理步骤完成${NC}"

# ========================================
# 总结
# ========================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAILED -gt 0 ]]; then
    echo -e "  ${RED}[FAIL] Cleanup 失败 ($FAILED 个错误)${NC}"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "  ${YELLOW}[WARN]  Cleanup 完成 ($WARNINGS 个警告)${NC}"
else
    echo -e "  ${GREEN}[OK] Cleanup 完成，无遗留${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
