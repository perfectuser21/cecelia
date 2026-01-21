#!/usr/bin/env bash
# ============================================================================
# Regression Contract Filter
# ============================================================================
#
# 按 trigger 过滤 RCI 列表
#
# 用法:
#   bash scripts/rc-filter.sh pr       # 输出 PR Gate 要跑的 RCI
#   bash scripts/rc-filter.sh release  # 输出 Release Gate 要跑的 RCI
#   bash scripts/rc-filter.sh nightly  # 输出全部 RCI（Nightly）
#   bash scripts/rc-filter.sh stats    # 输出统计信息
#
# ============================================================================

set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RC_FILE="$PROJECT_ROOT/regression-contract.yaml"

if [[ ! -f "$RC_FILE" ]]; then
    echo "错误: 找不到 $RC_FILE"
    exit 1
fi

MODE="${1:-stats}"

# 提取所有 RCI
extract_all() {
    # 使用 yq 或 grep 解析 YAML
    if command -v yq &>/dev/null; then
        yq -r '.. | select(has("id")) | [.id, .name, .priority, .trigger, .method] | @tsv' "$RC_FILE" 2>/dev/null
    else
        # 降级：用 grep 提取基本信息
        grep -E "^\s+- id:|^\s+name:|^\s+priority:|^\s+trigger:|^\s+method:" "$RC_FILE" | \
        paste - - - - - | \
        sed 's/- id://g; s/name://g; s/priority://g; s/trigger://g; s/method://g' | \
        tr -d '"[]' | \
        awk '{gsub(/^[ \t]+|[ \t]+$/, "", $1); gsub(/^[ \t]+|[ \t]+$/, "", $2); print $1"\t"$2"\t"$3"\t"$4"\t"$5}'
    fi
}

# 统计
show_stats() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Regression Contract 统计"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # 排除 GP-* 条目（Golden Paths 不是 RCI）
    TOTAL=$(grep "^\s*- id:" "$RC_FILE" | grep -cv "GP-" || echo 0)
    GP_COUNT=$(grep -c "id: GP-" "$RC_FILE" || echo 0)
    P0=$(grep -c "priority: P0" "$RC_FILE" || echo 0)
    P1=$(grep -c "priority: P1" "$RC_FILE" || echo 0)
    P2=$(grep -c "priority: P2" "$RC_FILE" || echo 0)
    AUTO=$(grep -c "method: auto" "$RC_FILE" || echo 0)
    MANUAL=$(grep -c "method: manual" "$RC_FILE" || echo 0)

    # 统计 trigger（简化版）
    # Golden Paths 也有 trigger，需要排除
    PR_COUNT=$(grep -E "trigger:.*PR" "$RC_FILE" | wc -l || echo 0)
    RELEASE_COUNT=$(grep -E "trigger:.*Release" "$RC_FILE" | wc -l || echo 0)
    # 减去 GP 的 trigger（GP 都是 Release 触发）
    PR_COUNT=$((PR_COUNT > GP_COUNT ? PR_COUNT - 0 : PR_COUNT))
    RELEASE_COUNT=$((RELEASE_COUNT - GP_COUNT))

    echo "  总 RCI 数量:    $TOTAL"
    echo "  Golden Paths:   $GP_COUNT"
    echo ""
    echo "  Priority 分布:"
    echo "    P0 (核心):    $P0"
    echo "    P1 (重要):    $P1"
    echo "    P2 (辅助):    $P2"
    echo ""
    echo "  Method 分布:"
    echo "    auto:         $AUTO"
    echo "    manual:       $MANUAL"
    echo ""
    echo "  Trigger 覆盖:"
    echo "    PR Gate:      $PR_COUNT 条"
    echo "    Release Gate: $RELEASE_COUNT 条"
    echo "    Nightly:      $TOTAL 条 (全部 RCI)"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 按 trigger 过滤
filter_by_trigger() {
    local trigger="$1"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  $trigger Gate - RCI 列表"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [[ "$trigger" == "Nightly" ]]; then
        # Nightly 跑全部（排除 GP-*）
        grep -B1 "^\s*- id:" "$RC_FILE" | grep "id:" | grep -v "GP-" | sed 's/.*id: /  /'
    else
        # PR/Release 按 trigger 过滤
        # 简化实现：找包含该 trigger 的条目
        awk -v trigger="$trigger" '
            /\- id:/ { id = $3 }
            /trigger:/ && $0 ~ trigger { print "  " id }
        ' "$RC_FILE" | grep -v "^  GP-"  # 排除 Golden Paths
    fi

    echo ""
}

case "$MODE" in
    pr|PR)
        filter_by_trigger "PR"
        ;;
    release|Release)
        filter_by_trigger "Release"
        ;;
    nightly|Nightly)
        filter_by_trigger "Nightly"
        ;;
    stats|stat)
        show_stats
        ;;
    *)
        echo "用法: $0 {pr|release|nightly|stats}"
        exit 1
        ;;
esac
