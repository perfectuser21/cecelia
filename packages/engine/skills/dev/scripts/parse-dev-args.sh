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
AUTONOMOUS_MODE=false

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
            AUTONOMOUS_MODE=true
            shift
            ;;
        *)
            # 忽略未知参数
            shift
            ;;
    esac
done

# ============================================================================
# 如果有 TASK_ID 且未显式传 --autonomous，查询 Brain payload
# ============================================================================

if [[ -n "${TASK_ID}" ]] && [[ "${AUTONOMOUS_MODE}" == "false" ]]; then
    _brain_url="${BRAIN_API_URL:-http://localhost:5221}"
    _payload_auto=$(curl -s --connect-timeout 2 --max-time 4 \
        "${_brain_url}/api/brain/tasks/${TASK_ID}" 2>/dev/null | \
        jq -r '.payload.autonomous_mode // false' 2>/dev/null || echo "false")
    if [[ "${_payload_auto}" == "true" ]]; then
        AUTONOMOUS_MODE=true
    fi
fi

# ============================================================================
# 输出
# ============================================================================

echo "TASK_ID=${TASK_ID}"
echo "AUTONOMOUS_MODE=${AUTONOMOUS_MODE}"
