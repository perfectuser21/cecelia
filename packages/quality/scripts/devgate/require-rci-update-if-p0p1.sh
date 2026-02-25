#!/usr/bin/env bash
# ============================================================================
# require-rci-update-if-p0p1.sh
# ============================================================================
#
# 检查 P0/P1 级别的 PR 是否更新了 regression-contract.yaml。
#
# 用法：
#   bash scripts/devgate/require-rci-update-if-p0p1.sh
#
# 环境变量：
#   PR_PRIORITY - 直接指定优先级
#   PR_TITLE    - PR 标题（用于检测优先级）
#   PR_LABELS   - PR labels（用于检测优先级）
#   BASE_REF    - 基准分支（默认 develop）
#
# 返回码：
#   0 - 检查通过（非 P0/P1，或已更新 RCI）
#   1 - P0/P1 但未更新 regression-contract.yaml
#   2 - 脚本执行错误
#
# ============================================================================

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# 找项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  P0/P1 → RCI 更新检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检测优先级
DETECT_SCRIPT="$PROJECT_ROOT/scripts/devgate/detect-priority.cjs"

if [[ ! -f "$DETECT_SCRIPT" ]]; then
    echo -e "  ${RED}❌ detect-priority.cjs 不存在${NC}"
    exit 2
fi

# 获取优先级
PRIORITY=$(node "$DETECT_SCRIPT" 2>/dev/null || echo "unknown")

echo "  检测到优先级: $PRIORITY"

# 如果不是 P0 或 P1，直接通过
if [[ "$PRIORITY" != "P0" && "$PRIORITY" != "P1" ]]; then
    echo ""
    echo -e "  ${GREEN}✅ 非 P0/P1，跳过 RCI 更新检查${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
fi

# P0/P1 必须更新 regression-contract.yaml
echo ""
echo "  [检查 regression-contract.yaml 变更]"

# 获取 base 分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
BASE_BRANCH="${BASE_REF:-$(git config "branch.$CURRENT_BRANCH.base-branch" 2>/dev/null || echo "develop")}"

# 检查 regression-contract.yaml 是否有变更
RCI_FILE="regression-contract.yaml"

# L2 fix: 检查 BASE_BRANCH 是否存在
if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
    echo -e "  ${YELLOW}Warning: Base branch '$BASE_BRANCH' not found, using HEAD~10${NC}"
    BASE_BRANCH="HEAD~10"
fi

# 方法 1: git diff（未提交的变更）
RCI_MODIFIED=$(git diff --name-only 2>/dev/null | grep -c "^$RCI_FILE$" 2>/dev/null || echo 0)

# 方法 2: git diff 对比 base 分支（已提交的变更）
RCI_IN_BRANCH=$(git diff "$BASE_BRANCH" --name-only 2>/dev/null | grep -c "^$RCI_FILE$" 2>/dev/null || echo 0)

# 方法 3: git log（本分支的提交记录）
RCI_IN_COMMITS=$(git log "$BASE_BRANCH"..HEAD --name-only 2>/dev/null | grep -c "^$RCI_FILE$" 2>/dev/null || echo 0)

# L3 fix: 安全清理数字，保证非空
clean_number() {
    local val="${1//[^0-9]/}"
    echo "${val:-0}"
}
RCI_MODIFIED=$(clean_number "$RCI_MODIFIED")
RCI_IN_BRANCH=$(clean_number "$RCI_IN_BRANCH")
RCI_IN_COMMITS=$(clean_number "$RCI_IN_COMMITS")

echo -n "  regression-contract.yaml... "

if [[ "$RCI_MODIFIED" -gt 0 || "$RCI_IN_BRANCH" -gt 0 || "$RCI_IN_COMMITS" -gt 0 ]]; then
    echo -e "${GREEN}✅ 已更新${NC}"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${GREEN}✅ P0/P1 RCI 更新检查通过${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
fi

# 未更新
echo -e "${RED}❌ 未更新${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${RED}❌ P0/P1 必须更新 regression-contract.yaml${NC}"
echo ""
echo "  P0/P1 级别的修复需要添加回归测试契约，以防止问题复发。"
echo ""
echo "  请在 regression-contract.yaml 中添加对应的 RCI 条目："
echo "    - id: <NEW_RCI_ID>"
echo "      name: \"<描述>\""
echo "      priority: $PRIORITY"
echo "      trigger: [PR, Release]"
echo "      ..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 1
