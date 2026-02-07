#!/bin/bash
set -euo pipefail

# Brain 状态可视化 CLI 工具
# Usage: brain-status [--okr|--tasks|--watch]

BRAIN_API="${BRAIN_API:-http://localhost:5221}"
REFRESH_INTERVAL=5  # seconds

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 检查 Brain API 可用性
check_brain_api() {
    if ! curl -sf "$BRAIN_API/api/brain/health" > /dev/null 2>&1; then
        echo -e "${RED}❌ Brain API 不可用: $BRAIN_API${NC}"
        echo "   请确保 Brain 服务正在运行"
        exit 1
    fi
}

# UTC 转北京时间
utc_to_beijing() {
    local utc_time="$1"
    if [[ -n "$utc_time" ]]; then
        TZ=Asia/Shanghai date -d "$utc_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "$utc_time"
    else
        echo "N/A"
    fi
}

# 计算时间差（多久之前）
time_ago() {
    local timestamp="$1"
    if [[ -z "$timestamp" || "$timestamp" == "null" ]]; then
        echo "N/A"
        return
    fi

    local then=$(date -d "$timestamp" +%s 2>/dev/null || echo "0")
    local now=$(date +%s)
    local diff=$((now - then))

    if [[ $diff -lt 60 ]]; then
        echo "${diff} 秒前"
    elif [[ $diff -lt 3600 ]]; then
        echo "$((diff / 60)) 分钟前"
    elif [[ $diff -lt 86400 ]]; then
        echo "$((diff / 3600)) 小时前"
    else
        echo "$((diff / 86400)) 天前"
    fi
}

# 绘制进度条
progress_bar() {
    local progress="$1"  # 0-100
    local width=10

    local filled=$((progress * width / 100))
    local empty=$((width - filled))

    printf "["
    for ((i=0; i<filled; i++)); do printf "█"; done
    for ((i=0; i<empty; i++)); do printf "░"; done
    printf "] %d%%" "$progress"
}

# 显示核心状态
show_core_status() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC} ${BLUE}🧠 Cecelia Brain 状态${NC}                  $(TZ=Asia/Shanghai date "+%Y-%m-%d %H:%M")  ${CYAN}║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"

    # 获取健康状态
    local health=$(curl -sf "$BRAIN_API/api/brain/health" | jq -r '.status // "unknown"')
    local health_icon="🔴"
    local health_color="$RED"
    if [[ "$health" == "healthy" ]]; then
        health_icon="🟢"
        health_color="$GREEN"
    elif [[ "$health" == "degraded" ]]; then
        health_icon="🟡"
        health_color="$YELLOW"
    fi

    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${health_icon} 健康状态: ${health_color}$(printf '%-20s' "$health")${NC}                              ${CYAN}║${NC}"

    # 获取 Tick 状态
    local tick_status=$(curl -sf "$BRAIN_API/api/brain/tick/status" 2>/dev/null || echo '{}')
    local last_tick=$(echo "$tick_status" | jq -r '.lastTickTime // null')
    local next_tick_in=$(echo "$tick_status" | jq -r '.nextTickIn // 0')

    echo -e "${CYAN}║${NC}  🔄 上次 Tick: $(time_ago "$last_tick")                      ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ⏭️  下次 Tick: $((next_tick_in / 1000 / 60)) 分钟后                           ${CYAN}║${NC}"

    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC} ${BLUE}保护系统${NC}                                                   ${CYAN}║${NC}"

    # 获取警觉等级
    local alertness=$(curl -sf "$BRAIN_API/api/brain/alertness" 2>/dev/null || echo '{}')
    local alertness_level=$(echo "$alertness" | jq -r '.level // "UNKNOWN"')
    local alertness_icon="🚦"

    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${alertness_icon} 警觉等级: ${YELLOW}$(printf '%-10s' "$alertness_level")${NC}                                 ${CYAN}║${NC}"

    # 获取看门狗状态（并发数）
    local watchdog=$(curl -sf "$BRAIN_API/api/brain/watchdog" 2>/dev/null || echo '{}')
    local concurrent=$(echo "$watchdog" | jq -r '.concurrent.current // 0')
    local max_concurrent=$(echo "$watchdog" | jq -r '.concurrent.max // 12')

    echo -e "${CYAN}║${NC}  🔌 并发槽位: $concurrent / $max_concurrent                                  ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
}

# 显示 OKR 状态
show_okr_status() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC} ${BLUE}当前聚焦 (每日焦点)${NC}                                          ${CYAN}║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"

    local focus=$(curl -sf "$BRAIN_API/api/brain/focus" 2>/dev/null || echo '{}')
    local objective=$(echo "$focus" | jq -r '.objective.title // "无聚焦目标"')
    local progress=$(echo "$focus" | jq -r '.objective.progress // 0')
    local kr_total=$(echo "$focus" | jq -r '.objective.krCount // 0')
    local kr_completed=$(echo "$focus" | jq -r '.objective.completedKrCount // 0')

    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  🎯 $(printf '%-50s' "$objective") ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  进度: $(progress_bar "$progress")                       ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}        ($kr_completed/$kr_total KR 完成)                          ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"

    # 显示当前 KR（如果有）
    local current_kr=$(echo "$focus" | jq -r '.currentKr.title // null')
    if [[ -n "$current_kr" && "$current_kr" != "null" ]]; then
        local kr_progress=$(echo "$focus" | jq -r '.currentKr.progress // 0')
        echo -e "${CYAN}║${NC}  🚧 当前 KR:                                              ${CYAN}║${NC}"
        echo -e "${CYAN}║${NC}     $(printf '%-48s' "$current_kr") ${CYAN}║${NC}"
        echo -e "${CYAN}║${NC}     进度: $(progress_bar "$kr_progress")                    ${CYAN}║${NC}"
        echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    fi

    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
}

# 显示任务队列
show_tasks_status() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC} ${BLUE}任务队列${NC}                                                      ${CYAN}║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"

    # 获取任务统计
    local queued=$(curl -sf "$BRAIN_API/api/brain/tasks?status=queued" 2>/dev/null | jq '. | length' || echo "0")
    local in_progress=$(curl -sf "$BRAIN_API/api/brain/tasks?status=in_progress" 2>/dev/null | jq '. | length' || echo "0")
    local completed=$(curl -sf "$BRAIN_API/api/brain/tasks?status=completed" 2>/dev/null | jq '. | length' || echo "0")

    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ⏳ Queued: $queued        🚧 In Progress: $in_progress      ✅ Completed: $completed ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                                                           ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
}

# 完整状态
show_full_status() {
    clear
    show_core_status
    echo ""
    show_okr_status
    echo ""
    show_tasks_status
    echo ""
    echo -e "${CYAN}提示: 运行 brain-status --watch 实时刷新${NC}"
    echo -e "${CYAN}     运行 brain-status --okr 查看 OKR 详情${NC}"
    echo -e "${CYAN}     运行 brain-status --tasks 查看任务详情${NC}"
}

# 主函数
main() {
    check_brain_api

    case "${1:-}" in
        --okr)
            show_okr_status
            ;;
        --tasks)
            show_tasks_status
            ;;
        --watch)
            while true; do
                show_full_status
                sleep "$REFRESH_INTERVAL"
            done
            ;;
        --help|-h)
            echo "Usage: brain-status [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (none)     显示完整状态"
            echo "  --okr      只显示 OKR 状态"
            echo "  --tasks    只显示任务队列"
            echo "  --watch    实时刷新（每 ${REFRESH_INTERVAL}s）"
            echo "  --help     显示帮助"
            ;;
        *)
            show_full_status
            ;;
    esac
}

main "$@"
