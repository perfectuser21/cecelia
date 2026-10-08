#!/usr/bin/env bash
# coding workflow runner 启动器（LaunchDaemon 每 5 分钟调一次）。
# 使用专用 clone（不碰主仓 checkout）：clone 不存在则 clone；工作区干净才自更新到 origin/main，
# 不干净只记日志、不破坏现场；然后 exec clone 里的 run-once.mjs（worktree prune 与保留期清理由它负责）。
# 主日志（CODING_WF_MAIN_LOG，launchd 的 StandardOutPath）超过 10MB 时 copy+truncate 滚动，保留 3 份。
set -uo pipefail

REPO="${CODING_WF_REPO:-$HOME/perfect21/cecelia-cw-runner}"
ORIGIN_URL="${CODING_WF_ORIGIN_URL:-https://github.com/perfectuser21/cecelia.git}"
NODE_BIN="${CODING_WF_NODE:-node}"
RUN_ONCE_REL="packages/brain/scripts/coding-workflow/runner/run-once.mjs"

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

if [ ! -d "$REPO/.git" ]; then
  log "clone 不存在，从 $ORIGIN_URL clone 到 $REPO"
  mkdir -p "$(dirname "$REPO")"
  if ! git clone -q "$ORIGIN_URL" "$REPO"; then
    log "clone 失败"
    exit 1
  fi
fi

if [ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
  if git -C "$REPO" fetch -q origin main && git -C "$REPO" reset -q --hard origin/main; then
    log "已自更新到 origin/main $(git -C "$REPO" rev-parse --short HEAD)"
  else
    log "自更新失败，沿用当前版本 $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)"
  fi
else
  log "工作区不干净，跳过自更新（不破坏现场）"
fi

cd "$REPO" || exit 1
exec "$NODE_BIN" "$REPO/$RUN_ONCE_REL"
