#!/usr/bin/env bash
# dev-heartbeat-guardian.sh — 维持灯亮的小傻子
# 用法：dev-heartbeat-guardian.sh <light_file_path>
#
# 行为：
#   - 每 GUARDIAN_INTERVAL_SEC 秒（默认 60）touch light_file 一次
#   - 收到 SIGTERM/SIGINT/SIGHUP → rm light_file + exit 0
#   - 父进程死亡（ppid → 1）→ rm light_file + exit 0
#   - 参数缺失 / touch 失败 → exit 1
set -uo pipefail

LIGHT="${1:-}"
[[ -z "$LIGHT" ]] && { echo "[guardian] usage: $0 <light_file>" >&2; exit 1; }

INTERVAL="${GUARDIAN_INTERVAL_SEC:-60}"
[[ "$INTERVAL" =~ ^[0-9]+$ ]] || INTERVAL=60
ORIGINAL_PPID=$PPID

cleanup() {
    rm -f "$LIGHT"
    exit 0
}
trap cleanup SIGTERM SIGINT SIGHUP

# 立即首次 touch
touch "$LIGHT" 2>/dev/null || { echo "[guardian] cannot create $LIGHT" >&2; exit 1; }

while true; do
    # ppid 自检 — 跨平台
    current_ppid=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ' || echo 1)
    if [[ "$current_ppid" != "$ORIGINAL_PPID" ]]; then
        cleanup
    fi

    sleep "$INTERVAL" &
    SLEEP_PID=$!
    wait "$SLEEP_PID" 2>/dev/null || true

    touch "$LIGHT" 2>/dev/null || cleanup
done
