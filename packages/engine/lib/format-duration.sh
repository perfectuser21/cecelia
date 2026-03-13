#!/usr/bin/env bash
# ============================================================================
# format-duration.sh — 时间格式化工具函数
# ============================================================================
# 用法: source "$(dirname "$0")/../lib/format-duration.sh"
# ============================================================================

# 将毫秒数转换为人类可读格式
# 用法: format_duration_ms <ms>
# 输出示例:
#   format_duration_ms 90061000  → "1d 1h 1m 1s"
#   format_duration_ms 3600000   → "1h 0m 0s"
#   format_duration_ms 65000     → "1m 5s"
#   format_duration_ms 500       → "0.5s"
#   format_duration_ms 0         → "0s"
format_duration_ms() {
    local ms="${1:-0}"

    # 纯整数校验
    if ! [[ "$ms" =~ ^[0-9]+$ ]]; then
        echo "0s"
        return 0
    fi

    local total_s=$((ms / 1000))
    local rem_ms=$((ms % 1000))

    if [[ $total_s -eq 0 ]]; then
        # 不足 1 秒：显示小数秒（保留一位小数）
        local tenths=$((rem_ms / 100))
        if [[ $rem_ms -eq 0 ]]; then
            echo "0s"
        else
            echo "${tenths:+0.}${tenths}s"
        fi
        return 0
    fi

    local days=$((total_s / 86400))
    local hours=$(( (total_s % 86400) / 3600 ))
    local minutes=$(( (total_s % 3600) / 60 ))
    local seconds=$((total_s % 60))

    local result=""
    if [[ $days -gt 0 ]]; then
        result="${days}d ${hours}h ${minutes}m ${seconds}s"
    elif [[ $hours -gt 0 ]]; then
        result="${hours}h ${minutes}m ${seconds}s"
    elif [[ $minutes -gt 0 ]]; then
        result="${minutes}m ${seconds}s"
    else
        result="${seconds}s"
    fi

    echo "$result"
}
