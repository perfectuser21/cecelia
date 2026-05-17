#!/bin/bash

# Social Media Analysis Skill - 主执行脚本

set -e

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$SKILL_DIR/scripts"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 使用说明
usage() {
    cat << EOF
Social Media Analysis Skill

Usage: $0 <command> [options]

Commands:
    query <platform>      查询指定平台数据
    trends                趋势分析
    compare <title>       跨平台对比
    report                生成报告
    top                   爆款排行

Examples:
    $0 query douyin --days 7
    $0 trends --threshold 10000
    $0 compare "想法再多"
    $0 report --format markdown
    $0 top --limit 10 --metric views

EOF
    exit 1
}

# 主逻辑
main() {
    local command=$1
    shift

    case "$command" in
        query)
            bash "$SCRIPTS_DIR/query.sh" "$@"
            ;;
        trends)
            bash "$SCRIPTS_DIR/trends.sh" "$@"
            ;;
        compare)
            bash "$SCRIPTS_DIR/compare.sh" "$@"
            ;;
        report)
            bash "$SCRIPTS_DIR/report.sh" "$@"
            ;;
        top)
            bash "$SCRIPTS_DIR/top.sh" "$@"
            ;;
        *)
            usage
            ;;
    esac
}

# 检查参数
if [ $# -eq 0 ]; then
    usage
fi

main "$@"
