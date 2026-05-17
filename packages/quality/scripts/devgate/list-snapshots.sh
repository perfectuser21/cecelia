#!/usr/bin/env bash
# ============================================================================
# list-snapshots.sh
# ============================================================================
#
# 列出所有 PRD/DoD 快照。
#
# 用法：
#   bash scripts/devgate/list-snapshots.sh [--json]
#
# 输出：
#   默认：格式化表格
#   --json：JSON 数组
#
# ============================================================================

set -euo pipefail

# 找项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
HISTORY_DIR="$PROJECT_ROOT/.history"

# 检查参数
JSON_OUTPUT=false
if [[ "${1:-}" == "--json" ]]; then
    JSON_OUTPUT=true
fi

# 检查目录存在
if [[ ! -d "$HISTORY_DIR" ]]; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        echo "[]"
    else
        # L3 fix: 统一使用英文
        echo "No snapshots found"
    fi
    exit 0
fi

# L2 fix: 获取所有快照（按时间戳排序，正确处理 PR 号）
# 文件名格式: PR-204-20260122-1048.prd.md，按时间戳部分倒序
SNAPSHOTS=$(find "$HISTORY_DIR" -name "PR-*.prd.md" -type f 2>/dev/null | sort -t'-' -k3,3r -k4,4r)

if [[ -z "$SNAPSHOTS" ]]; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        echo "[]"
    else
        echo "No snapshots found"
    fi
    exit 0
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
    # JSON 输出
    echo "["
    FIRST=true
    while IFS= read -r prd_file; do
        [[ -z "$prd_file" ]] && continue

        # 提取信息
        filename=$(basename "$prd_file")
        # PR-204-20260122-1048.prd.md
        pr_number=$(echo "$filename" | sed 's/PR-\([0-9]*\)-.*/\1/')
        timestamp=$(echo "$filename" | sed 's/PR-[0-9]*-\([0-9]*-[0-9]*\).*/\1/')

        dod_file="${prd_file%.prd.md}.dod.md"
        has_dod="false"
        [[ -f "$dod_file" ]] && has_dod="true"

        if [[ "$FIRST" == "true" ]]; then
            FIRST=false
        else
            echo ","
        fi

        echo -n "  {\"pr\": $pr_number, \"timestamp\": \"$timestamp\", \"prd\": \"$filename\", \"has_dod\": $has_dod}"
    done <<< "$SNAPSHOTS"
    echo ""
    echo "]"
else
    # 表格输出 (L3 fix: 统一使用英文)
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  PRD/DoD Snapshot List"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    printf "  %-8s %-15s %-35s\n" "PR" "Time" "File"
    printf "  %-8s %-15s %-35s\n" "--------" "---------------" "-----------------------------------"

    while IFS= read -r prd_file; do
        [[ -z "$prd_file" ]] && continue

        filename=$(basename "$prd_file")
        pr_number=$(echo "$filename" | sed 's/PR-\([0-9]*\)-.*/\1/')
        timestamp=$(echo "$filename" | sed 's/PR-[0-9]*-\([0-9]*-[0-9]*\).*/\1/')

        printf "  %-8s %-15s %-35s\n" "#$pr_number" "$timestamp" "$filename"
    done <<< "$SNAPSHOTS"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  View snapshot: bash scripts/devgate/view-snapshot.sh <PR_NUMBER>"
    echo ""
fi

exit 0
