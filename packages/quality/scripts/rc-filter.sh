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

# L3 fix: 添加 --help 选项
show_help() {
    echo "Regression Contract Filter"
    echo ""
    echo "用法: $0 [MODE]"
    echo ""
    echo "MODE:"
    echo "  pr        输出 PR Gate 要跑的 RCI"
    echo "  release   输出 Release Gate 要跑的 RCI"
    echo "  nightly   输出全部 RCI (Nightly)"
    echo "  stats     输出统计信息 (默认)"
    echo "  -h,--help 显示帮助"
    echo ""
    echo "示例:"
    echo "  $0 pr       # 列出 PR Gate 的 RCI"
    echo "  $0 stats    # 显示统计"
}

# 检查 yq 版本并返回合适的语法
# L2 fix: 支持 yq v3 和 v4 不同的语法
get_yq_cmd() {
    if ! command -v yq &>/dev/null; then
        echo ""
        return
    fi

    # 检测 yq 版本 (v3 vs v4)
    local yq_version
    yq_version=$(yq --version 2>&1 || echo "")

    if [[ "$yq_version" == *"version 3"* ]] || [[ "$yq_version" == *"mikefarah/yq version 3"* ]]; then
        echo "v3"
    else
        echo "v4"
    fi
}

MODE="${1:-stats}"

# L3 fix: 处理 --help
if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
    show_help
    exit 0
fi

# 提取所有 RCI
# L2 fix: 支持 yq v3/v4 语法差异
extract_all() {
    local yq_ver
    yq_ver=$(get_yq_cmd)

    if [[ "$yq_ver" == "v4" ]]; then
        # yq v4 语法
        yq eval '.. | select(has("id")) | [.id, .name, .priority, .trigger, .method] | @tsv' "$RC_FILE" 2>/dev/null
    elif [[ "$yq_ver" == "v3" ]]; then
        # yq v3 语法 (Python 版本)
        yq -r '.. | select(has("id")) | [.id, .name, .priority, .trigger, .method] | @tsv' "$RC_FILE" 2>/dev/null
    else
        # L2 fix: 更健壮的 grep 降级方案
        # 使用 awk 逐条解析，避免 paste 对齐问题
        awk '
            /^[[:space:]]*- id:/ { id = $3; gsub(/["\047]/, "", id) }
            /^[[:space:]]*name:/ { name = $2; for(i=3;i<=NF;i++) name = name " " $i; gsub(/["\047]/, "", name) }
            /^[[:space:]]*priority:/ { priority = $2 }
            /^[[:space:]]*trigger:/ { trigger = $0; gsub(/.*trigger:/, "", trigger); gsub(/[[:space:]\[\]]/, "", trigger) }
            /^[[:space:]]*method:/ { method = $2; print id"\t"name"\t"priority"\t"trigger"\t"method }
        ' "$RC_FILE"
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
    # P2 修复: 确保变量有默认值，避免算术比较失败
    TOTAL=$(grep "^\s*- id:" "$RC_FILE" | grep -cv "GP-" || echo 0)
    GP_COUNT=$(grep -c "id: GP-" "$RC_FILE" || echo 0)
    P0=$(grep -c "priority: P0" "$RC_FILE" || echo 0)
    P1=$(grep -c "priority: P1" "$RC_FILE" || echo 0)
    P2=$(grep -c "priority: P2" "$RC_FILE" || echo 0)
    AUTO=$(grep -c "method: auto" "$RC_FILE" || echo 0)
    MANUAL=$(grep -c "method: manual" "$RC_FILE" || echo 0)
    # 确保所有变量非空
    TOTAL=${TOTAL:-0}; GP_COUNT=${GP_COUNT:-0}
    P0=${P0:-0}; P1=${P1:-0}; P2=${P2:-0}
    AUTO=${AUTO:-0}; MANUAL=${MANUAL:-0}

    # 统计 trigger（排除 Golden Paths）
    # 使用 awk 精确统计：只统计非 GP 条目的 trigger
    PR_COUNT=$(awk '
        /- id:/ { id = $3; is_gp = (id ~ /^GP-/) }
        /trigger:/ && !is_gp && /PR/ { count++ }
        END { print count+0 }
    ' "$RC_FILE")
    RELEASE_COUNT=$(awk '
        /- id:/ { id = $3; is_gp = (id ~ /^GP-/) }
        /trigger:/ && !is_gp && /Release/ { count++ }
        END { print count+0 }
    ' "$RC_FILE")

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
