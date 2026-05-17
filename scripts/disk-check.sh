#!/bin/bash
set -euo pipefail

# 磁盘空间监控脚本
# 用途：检查磁盘使用率，超过阈值时发出警告
# 可被 Brain tick、cron 或 janitor 调用

THRESHOLD=${DISK_CHECK_THRESHOLD:-80}
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

check_disk() {
    local mount_point="${1:-/}"

    # 获取磁盘使用率（兼容 macOS 和 Linux）
    local disk_usage
    if [[ "$(uname)" == "Darwin" ]]; then
        disk_usage=$(df -h "$mount_point" | tail -1 | awk '{print $5}' | tr -d '%')
    else
        disk_usage=$(df -h "$mount_point" | tail -1 | awk '{print $5}' | tr -d '%')
    fi

    echo "磁盘使用率 (${mount_point}): ${disk_usage}%"

    if [ "$disk_usage" -gt "$THRESHOLD" ]; then
        echo "WARNING: 磁盘使用率 ${disk_usage}% 超过阈值 ${THRESHOLD}%"

        # 尝试自动清理
        cleanup_suggestions "$mount_point" "$disk_usage"

        return 1
    else
        echo "OK: 磁盘使用率在安全范围内"
        return 0
    fi
}

cleanup_suggestions() {
    local mount_point="$1"
    local usage="$2"

    echo ""
    echo "=== 自动清理建议 ==="

    # 检查 PM2 日志大小
    if command -v pm2 >/dev/null 2>&1; then
        local pm2_log_dir="$HOME/.pm2/logs"
        if [ -d "$pm2_log_dir" ]; then
            local log_size
            log_size=$(du -sh "$pm2_log_dir" 2>/dev/null | awk '{print $1}')
            echo "PM2 日志目录: ${log_size} (${pm2_log_dir})"
            echo "  清理命令: pm2 flush"
        fi
    fi

    # 检查 /tmp 下的 Brain 日志
    local tmp_brain_logs
    tmp_brain_logs=$(ls -la /tmp/cecelia-brain-*.log 2>/dev/null | wc -l | tr -d ' ')
    if [ "$tmp_brain_logs" -gt 0 ]; then
        local tmp_size
        tmp_size=$(du -sh /tmp/cecelia-brain-*.log 2>/dev/null | tail -1 | awk '{print $1}')
        echo "Brain 临时日志: ${tmp_size}"
    fi

    # 检查 npm 缓存
    if command -v npm >/dev/null 2>&1; then
        echo "npm 缓存清理: npm cache clean --force"
    fi

    # 检查 Docker（如果存在）
    if command -v docker >/dev/null 2>&1; then
        local docker_usage
        docker_usage=$(docker system df 2>/dev/null | head -5 || echo "Docker 不可用")
        echo "Docker 空间:"
        echo "$docker_usage"
        echo "  清理命令: docker system prune -f"
    fi

    echo ""
    echo "=== 磁盘使用率: ${usage}% (阈值: ${THRESHOLD}%) ==="
}

# 主逻辑
main() {
    echo "=== Cecelia 磁盘空间检查 ==="
    echo "时间: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S') (上海时间)"
    echo ""

    local exit_code=0

    # 检查根分区
    check_disk "/" || exit_code=1

    # macOS: 检查 /System/Volumes/Data（实际数据分区）
    if [[ "$(uname)" == "Darwin" ]] && mount | grep -q "/System/Volumes/Data"; then
        check_disk "/System/Volumes/Data" || exit_code=1
    fi

    exit $exit_code
}

main "$@"
