#!/usr/bin/env bash
# dev-heartbeat-guardian.sh — 保持 .dev-mode* 和 .dev-lock* 文件的 mtime 活跃
#
# 用法: nohup bash dev-heartbeat-guardian.sh <light_file> &
#
# 工作原理:
#   - <light_file> 是 .cecelia/lights/<sid>-<branch>.live 文件路径
#   - 每 HEARTBEAT_INTERVAL 秒 touch 一次该 light file 以及同 worktree 下的
#     所有 .dev-mode* 和 .dev-lock* 文件，更新 mtime
#   - 当 light file 被删除（Stop Hook 或 worktree remove 时发生），自动退出
#   - 当 GUARDIAN_ORPHAN_MODE=1 时忽略父进程 PID 检查（fork 后父进程可能已退出）
#
# zombie-cleaner.js 的 isWorktreeActive() 依赖这些文件的 mtime 来判断 worktree 是否活跃。
# 没有本 guardian，长时间运行（>24h）的 session worktree 会因 mtime 过期被误杀。

set -euo pipefail

LIGHT_FILE="${1:-}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-300}"  # 每 5 分钟续期一次

if [[ -z "$LIGHT_FILE" ]]; then
    echo "[heartbeat-guardian] 错误: 需要传入 light_file 路径" >&2
    exit 1
fi

# 从 light file 内容解析 worktree_path（JSON 格式）
get_worktree_path() {
    local lf="$1"
    [[ -f "$lf" ]] || return 1
    python3 -c "import json,sys; d=json.load(open('$lf')); print(d.get('worktree_path',''))" 2>/dev/null || \
        grep -o '"worktree_path"[[:space:]]*:[[:space:]]*"[^"]*"' "$lf" 2>/dev/null | \
        sed 's/.*: *"\(.*\)"/\1/' || true
}

touch_signal_files() {
    local wt_path="$1"
    [[ -d "$wt_path" ]] || return 0
    # touch .dev-mode* 和 .dev-lock* 文件更新 mtime
    find "$wt_path" -maxdepth 1 \( -name '.dev-mode*' -o -name '.dev-lock*' \) -exec touch {} \; 2>/dev/null || true
}

echo "[heartbeat-guardian] 启动，light_file=${LIGHT_FILE}" >&2

CONSECUTIVE_MISS=0
MAX_MISS=3  # light file 连续 3 次不存在才退出（防止瞬间 race）

while true; do
    sleep "$HEARTBEAT_INTERVAL"

    # 检查 light file 是否还存在
    if [[ ! -f "$LIGHT_FILE" ]]; then
        CONSECUTIVE_MISS=$(( CONSECUTIVE_MISS + 1 ))
        if (( CONSECUTIVE_MISS >= MAX_MISS )); then
            echo "[heartbeat-guardian] light_file 不存在 ${CONSECUTIVE_MISS} 次，退出" >&2
            exit 0
        fi
        continue
    fi
    CONSECUTIVE_MISS=0

    # touch light file 本身
    touch "$LIGHT_FILE" 2>/dev/null || true

    # 解析 worktree_path 并 touch 信号文件
    wt_path="$(get_worktree_path "$LIGHT_FILE")"
    if [[ -n "$wt_path" && -d "$wt_path" ]]; then
        touch_signal_files "$wt_path"
        echo "[heartbeat-guardian] 续期 mtime: ${wt_path}" >&2
    fi
done
