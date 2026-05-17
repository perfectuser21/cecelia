#!/usr/bin/env bash
#
# record-step.sh
# 记录 /dev workflow 每一步的执行数据
#
# Usage:
#   bash skills/dev/scripts/record-step.sh start <step_name>
#   bash skills/dev/scripts/record-step.sh end <step_name> [status] [issue]
#
# 输出：追加到 .dev-execution-log.jsonl
#

set -euo pipefail

# ============================================================================
# 常量
# ============================================================================

LOG_FILE=".dev-execution-log.jsonl"
TEMP_DIR=".dev-temp"

# ============================================================================
# 工具函数
# ============================================================================

# 获取当前时间戳（秒）
get_timestamp() {
    date +%s
}

# 获取步骤编号
get_step_number() {
    local step_name="$1"
    case "$step_name" in
        prd) echo "01" ;;
        detect) echo "02" ;;
        branch) echo "03" ;;
        dod) echo "04" ;;
        code) echo "05" ;;
        test) echo "06" ;;
        quality) echo "07" ;;
        pr) echo "08" ;;
        ci) echo "09" ;;
        learning) echo "10" ;;
        cleanup) echo "11" ;;
        *) echo "00" ;;
    esac
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    local action="${1:-}"
    local step_name="${2:-}"
    local status="${3:-success}"
    local issue="${4:-}"

    if [[ -z "$action" || -z "$step_name" ]]; then
        echo "Usage: $0 start|end <step_name> [status] [issue]" >&2
        exit 1
    fi

    # 确保临时目录存在
    mkdir -p "$TEMP_DIR"

    local step_number
    step_number=$(get_step_number "$step_name")
    local step_id="${step_number}-${step_name}"

    case "$action" in
        start)
            # 记录开始时间
            local start_time
            start_time=$(get_timestamp)
            echo "$start_time" > "$TEMP_DIR/${step_id}.start"
            ;;

        end)
            # 读取开始时间
            local start_time=0
            if [[ -f "$TEMP_DIR/${step_id}.start" ]]; then
                start_time=$(cat "$TEMP_DIR/${step_id}.start")
            fi

            local end_time
            end_time=$(get_timestamp)
            local duration=$((end_time - start_time))

            # 读取重试次数
            local retries=0
            if [[ -f "$TEMP_DIR/${step_id}.retries" ]]; then
                retries=$(cat "$TEMP_DIR/${step_id}.retries")
            fi

            # 读取问题列表
            local issues="[]"
            if [[ -n "$issue" ]]; then
                issues="[\"$issue\"]"
            elif [[ -f "$TEMP_DIR/${step_id}.issues" ]]; then
                issues=$(jq -Rs 'split("\n") | map(select(length > 0))' < "$TEMP_DIR/${step_id}.issues")
            fi

            # 写入日志（JSONL 格式）
            jq -n \
                --arg step "$step_id" \
                --argjson start "$start_time" \
                --argjson end_time "$end_time" \
                --argjson duration "$duration" \
                --arg status "$status" \
                --argjson issues "$issues" \
                --argjson retries "$retries" \
                '{
                    step: $step,
                    start: $start,
                    end: $end_time,
                    duration: $duration,
                    status: $status,
                    issues: $issues,
                    retries: $retries
                }' >> "$LOG_FILE"

            # 清理临时文件
            rm -f "$TEMP_DIR/${step_id}.start" "$TEMP_DIR/${step_id}.retries" "$TEMP_DIR/${step_id}.issues"
            ;;

        retry)
            # 增加重试计数
            local retries=0
            if [[ -f "$TEMP_DIR/${step_id}.retries" ]]; then
                retries=$(cat "$TEMP_DIR/${step_id}.retries")
            fi
            retries=$((retries + 1))
            echo "$retries" > "$TEMP_DIR/${step_id}.retries"
            ;;

        issue)
            # 记录问题
            if [[ -n "$status" ]]; then
                echo "$status" >> "$TEMP_DIR/${step_id}.issues"
            fi
            ;;

        *)
            echo "Unknown action: $action" >&2
            exit 1
            ;;
    esac
}

# ============================================================================
# 入口
# ============================================================================

main "$@"
