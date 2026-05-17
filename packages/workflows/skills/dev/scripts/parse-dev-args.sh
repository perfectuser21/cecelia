#!/usr/bin/env bash
#
# parse-dev-args.sh
# 解析 /dev 命令行参数
#
# Usage:
#   task_id=$(bash skills/dev/scripts/parse-dev-args.sh "$@")
#
# 支持的参数：
#   --task-id <task_id>  从数据库读取 Task PRD
#
# 输出：
#   task_id 到 stdout（如果提供）
#   无参数时输出空字符串

set -euo pipefail

# ============================================================================
# 参数解析
# ============================================================================

TASK_ID=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --task-id)
            if [[ $# -lt 2 ]]; then
                echo "错误：--task-id 需要一个参数" >&2
                exit 1
            fi
            TASK_ID="$2"
            shift 2
            ;;
        *)
            # 忽略未知参数
            shift
            ;;
    esac
done

# ============================================================================
# 输出
# ============================================================================

echo "$TASK_ID"
