#!/usr/bin/env bash
# coding workflow runner 启动器（LaunchDaemon 每 5 分钟调一次）。
# 使用专用 clone（不碰主仓 checkout）：clone 不存在则 clone；仅精确未跟踪心跳噪音可豁免，满足安全快进条件才自更新到 origin/main（HEAD 变了才记一行），
# 未通过安全更新检查则本轮停止、不破坏现场；通过后执行 clone 里的 run-once.mjs（worktree prune 与保留期清理由它负责）。
# 多仓库（C5）：其他已启用仓库（repos.json enabled + CODING_WF_REPOS）的 clone 不存在时按 repos.json 的路径与 origin clone；
# 已存在的不 fetch、不 reset（各道门按需 fetch origin，不动现场——路径万一指到人用的目录也不会被冲掉）。
# 主日志（CODING_WF_MAIN_LOG，launchd 的 StandardOutPath）超过 10MB 时 copy+truncate 滚动，保留 3 份。
set -uo pipefail

NODE_BIN="${CODING_WF_NODE:-node}"

MAIN_LOG="${CODING_WF_MAIN_LOG:-}"
LOG_MAX_BYTES=$((10 * 1024 * 1024))

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] [coding-workflow-runner.sh] $*" >&2; }

# launchd 持有日志的打开句柄：用 copy+truncate 而不是 mv，句柄继续写原文件
if [ -n "$MAIN_LOG" ] && [ -f "$MAIN_LOG" ] && [ "$(wc -c < "$MAIN_LOG")" -gt "$LOG_MAX_BYTES" ]; then
  [ -f "$MAIN_LOG.2" ] && mv -f "$MAIN_LOG.2" "$MAIN_LOG.3"
  [ -f "$MAIN_LOG.1" ] && mv -f "$MAIN_LOG.1" "$MAIN_LOG.2"
  cp "$MAIN_LOG" "$MAIN_LOG.1" && : > "$MAIN_LOG"
  log "主日志超过 10MB，已滚动"
fi

# 从 git 钩子 / claude 会话继承来的变量会把 git 与子 claude 带偏
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDECODE
for var in $(compgen -e | grep '^CLAUDE_CODE_' || true); do unset "$var"; done
export GIT_TERMINAL_PROMPT=0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$NODE_BIN" "$HERE/runtime-launch.mjs"
