#!/usr/bin/env bash
# ============================================================================
# view-snapshot.sh
# ============================================================================
#
# 查看指定 PR 的 PRD/DoD 快照。
#
# 用法：
#   bash scripts/devgate/view-snapshot.sh <PR号>
#   bash scripts/devgate/view-snapshot.sh <PR号> --prd   # 只看 PRD
#   bash scripts/devgate/view-snapshot.sh <PR号> --dod   # 只看 DoD
#
# 示例：
#   bash scripts/devgate/view-snapshot.sh 204
#
# ============================================================================

set -euo pipefail

# 颜色
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m'

# 参数检查
if [[ $# -lt 1 ]]; then
    echo "用法: bash scripts/devgate/view-snapshot.sh <PR号> [--prd|--dod]" >&2
    exit 1
fi

PR_NUMBER="$1"
VIEW_TYPE="${2:-all}"  # all, --prd, --dod

# L3 fix: 验证 VIEW_TYPE 有效值
if [[ "$VIEW_TYPE" != "all" && "$VIEW_TYPE" != "--prd" && "$VIEW_TYPE" != "--dod" ]]; then
    echo "Error: Invalid view type '$VIEW_TYPE'. Use --prd or --dod" >&2
    exit 1
fi

# 处理 PR 号（支持带 # 或不带）
PR_NUMBER="${PR_NUMBER#\#}"
PR_NUMBER="${PR_NUMBER#PR-}"

# 验证 PR 号是数字
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "错误: PR 号必须是数字" >&2
    exit 1
fi

# 找项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
HISTORY_DIR="$PROJECT_ROOT/.history"

# 检查目录存在
if [[ ! -d "$HISTORY_DIR" ]]; then
    echo "错误: .history/ 目录不存在" >&2
    exit 1
fi

# 查找该 PR 的快照（可能有多个时间戳，取最新的）
PRD_FILES=$(find "$HISTORY_DIR" -name "PR-${PR_NUMBER}-*.prd.md" -type f 2>/dev/null | sort -r)

if [[ -z "$PRD_FILES" ]]; then
    echo "错误: 找不到 PR #${PR_NUMBER} 的快照" >&2
    echo "" >&2
    echo "可用的快照：" >&2
    # P3 修复: 调用外部脚本前检查存在性
    LIST_SCRIPT="$PROJECT_ROOT/scripts/devgate/list-snapshots.sh"
    if [[ -f "$LIST_SCRIPT" ]]; then
        bash "$LIST_SCRIPT" >&2
    else
        echo "  (list-snapshots.sh 不存在)" >&2
    fi
    exit 1
fi

# 取最新的
PRD_FILE=$(echo "$PRD_FILES" | head -1)
DOD_FILE="${PRD_FILE%.prd.md}.dod.md"

# L2 fix: 如果有多个快照，告知用户
SNAPSHOT_COUNT=$(echo "$PRD_FILES" | wc -l)
if [[ "$SNAPSHOT_COUNT" -gt 1 ]]; then
    echo -e "${YELLOW}Note: PR #${PR_NUMBER} has $SNAPSHOT_COUNT snapshots, showing the latest one${NC}" >&2
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PR #${PR_NUMBER} 快照"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 显示 PRD
if [[ "$VIEW_TYPE" == "all" || "$VIEW_TYPE" == "--prd" ]]; then
    echo ""
    echo -e "${CYAN}=== PRD ===${NC}"
    echo ""
    if [[ -f "$PRD_FILE" ]]; then
        cat "$PRD_FILE"
    else
        echo -e "${YELLOW}(PRD 文件不存在)${NC}"
    fi
fi

# 显示 DoD
if [[ "$VIEW_TYPE" == "all" || "$VIEW_TYPE" == "--dod" ]]; then
    echo ""
    echo -e "${CYAN}=== DoD ===${NC}"
    echo ""
    if [[ -f "$DOD_FILE" ]]; then
        cat "$DOD_FILE"
    else
        echo -e "${YELLOW}(DoD 文件不存在)${NC}"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
