#!/usr/bin/env bash
#
# parse-dev-args.sh
# 解析 /dev 命令行参数
#
# Usage:
#   source <(bash skills/dev/scripts/parse-dev-args.sh "$@")
#
# 支持的参数：
#   --task-id <task_id>   从数据库读取 Task PRD
#   --autonomous          启用自主模式 (AUTONOMOUS_MODE=true)
#
# 输出（每行一个 KEY=VALUE）：
#   TASK_ID=<值或空>
#   AUTONOMOUS_MODE=true|false

set -euo pipefail

# ============================================================================
# 变量初始化
# ============================================================================

TASK_ID=""
# Phase 1 统一后 /dev 永远 autonomous。保留变量供下游脚本兼容读取。
AUTONOMOUS_MODE=true

# ============================================================================
# 参数解析
# ============================================================================

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
        --autonomous)
            # Phase 1 统一后 --autonomous 已废弃（/dev 默认 autonomous）
            # 保留别名防老脚本报错，只 warn 不做任何事
            echo "⚠️  --autonomous flag deprecated since Engine 14.17.8 (Phase 1 Round 2): /dev now defaults to autonomous" >&2
            shift
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

echo "TASK_ID=${TASK_ID}"
echo "AUTONOMOUS_MODE=${AUTONOMOUS_MODE}"
