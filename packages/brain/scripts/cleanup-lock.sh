#!/usr/bin/env bash
# cleanup-lock.sh — bash 端跨进程互斥锁 helper
#
# 跟 packages/brain/src/utils/cleanup-lock.js 同协议（mkdir /tmp/cecelia-cleanup.lock）
# 跨 macOS / Linux（不依赖 flock(1)，macOS 无）
#
# 用法：
#   source packages/brain/scripts/cleanup-lock.sh
#   acquire_cleanup_lock || { echo "skip"; exit 0; }
#   trap 'release_cleanup_lock' EXIT
#   git worktree remove ...
#
# 或一行式：
#   bash cleanup-lock.sh wrap "git worktree remove $WT_PATH"

CLEANUP_LOCK_DIR="${CLEANUP_LOCK_DIR:-/tmp/cecelia-cleanup.lock}"
CLEANUP_LOCK_TIMEOUT="${CLEANUP_LOCK_TIMEOUT:-30}"
CLEANUP_LOCK_STALE="${CLEANUP_LOCK_STALE:-60}"

acquire_cleanup_lock() {
  local elapsed=0
  while ! mkdir "$CLEANUP_LOCK_DIR" 2>/dev/null; do
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -gt "$CLEANUP_LOCK_TIMEOUT" ]; then
      echo "[cleanup-lock] timeout after ${CLEANUP_LOCK_TIMEOUT}s" >&2
      return 1
    fi
    # stale 检测
    if [ -d "$CLEANUP_LOCK_DIR" ]; then
      local age
      if [[ "$OSTYPE" == "darwin"* ]]; then
        age=$(($(date +%s) - $(stat -f %m "$CLEANUP_LOCK_DIR" 2>/dev/null || echo 0)))
      else
        age=$(($(date +%s) - $(stat -c %Y "$CLEANUP_LOCK_DIR" 2>/dev/null || echo 0)))
      fi
      if [ "$age" -gt "$CLEANUP_LOCK_STALE" ]; then
        echo "[cleanup-lock] breaking stale lock (age=${age}s, threshold=${CLEANUP_LOCK_STALE}s)" >&2
        rmdir "$CLEANUP_LOCK_DIR" 2>/dev/null || true
        continue
      fi
    fi
    sleep 1
  done
  return 0
}

release_cleanup_lock() {
  rmdir "$CLEANUP_LOCK_DIR" 2>/dev/null || true
}

# CLI mode: wrap a command
if [ "${1:-}" = "wrap" ]; then
  shift
  if ! acquire_cleanup_lock; then
    echo "[cleanup-lock] skipping wrapped command due to lock contention" >&2
    exit 0
  fi
  trap 'release_cleanup_lock' EXIT
  bash -c "$*"
fi
