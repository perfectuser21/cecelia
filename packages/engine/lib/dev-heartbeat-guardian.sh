#!/usr/bin/env bash
# dev-heartbeat-guardian.sh — 维持灯亮的小傻子
# 用法：dev-heartbeat-guardian.sh <light_file_path>
#
# 行为：
#   - 每 GUARDIAN_INTERVAL_SEC 秒（默认 60）touch light_file 一次
#   - 收到 SIGTERM/SIGINT/SIGHUP → rm light_file + exit 0
#   - 参数缺失 / touch 失败 → exit 1
#   - 父活性检测（任一触发 → cleanup）：
#       a) GUARDIAN_PARENT_PID 设置时（PR-2 推荐）：检查该 PID 仍存活；死则 cleanup
#       b) 否则（PR-1 fallback）：检查 PPID 没变；变了（孤儿）则 cleanup
set -uo pipefail

LIGHT="${1:-}"
[[ -z "$LIGHT" ]] && { echo "[guardian] usage: $0 <light_file>" >&2; exit 1; }

INTERVAL="${GUARDIAN_INTERVAL_SEC:-60}"
[[ "$INTERVAL" =~ ^[0-9]+$ ]] || INTERVAL=60
ORIGINAL_PPID=$PPID
# 模式选择：env var GUARDIAN_PARENT_PID 是否被显式设置（即使空值也算 PR-2 模式）
# - 已设置（空或非空）：PR-2 模式 — 不做 ppid 自动 cleanup（依赖 SIGTERM / SIGHUP）
# - 未设置：PR-1 fallback — 做 ppid 自检（孤儿即 cleanup）
PARENT_PID="${GUARDIAN_PARENT_PID:-}"
USE_EXPLICIT_PARENT=${GUARDIAN_PARENT_PID+1}

cleanup() {
    rm -f "$LIGHT"
    exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# 立即首次 touch
touch "$LIGHT" 2>/dev/null || { echo "[guardian] cannot create $LIGHT" >&2; exit 1; }

while true; do
    if [[ -n "${USE_EXPLICIT_PARENT:-}" ]]; then
        # PR-2 模式：env var 显式设置过 — 仅在 PARENT_PID 非空时做存活探针
        # PARENT_PID 为空（未识别到 claude 进程）→ 不做父探活，依赖 SIGTERM/SIGHUP/TTL
        if [[ -n "$PARENT_PID" ]]; then
            kill -0 "$PARENT_PID" 2>/dev/null || cleanup
        fi
    else
        # PR-1 fallback: ppid 自检（跨平台）— 立刻成孤儿即 cleanup
        # 优先 ps，缺失时（精简容器）退到 /proc/$$/status（Linux only）；都失败则保守不触发 cleanup
        current_ppid=""
        if command -v ps &>/dev/null; then
            current_ppid=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ' || echo "")
        elif [[ -r "/proc/$$/status" ]]; then
            current_ppid=$(awk '/^PPid:/{print $2}' "/proc/$$/status" 2>/dev/null || echo "")
        fi
        if [[ -n "$current_ppid" && "$current_ppid" != "$ORIGINAL_PPID" ]]; then
            cleanup
        fi
    fi

    sleep "$INTERVAL" &
    SLEEP_PID=$!
    wait "$SLEEP_PID" 2>/dev/null || true

    touch "$LIGHT" 2>/dev/null || cleanup
done
