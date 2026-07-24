#!/usr/bin/env bash
# review-preview.sh — 把已 build 好的 staging 产物在 review 端口跑起来
# 用法：bash scripts/review-preview.sh <PORT> <PR_NUMBER> [DIST_DIR]
# DIST_DIR 默认用 apps/dashboard/.dist-staging（evaluator 刚 build 的产物）

set -uo pipefail

PORT="${1:?需要端口号}"
PR_NUMBER="${2:?需要 PR 号}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASH_DIR="$MAIN_ROOT/apps/dashboard"
DIST_DIR="${3:-$DASH_DIR/.dist-staging}"
SLOT_SERVER="$MAIN_ROOT/scripts/dashboard-slot-server.cjs"
PID_FILE="/tmp/review-preview-${PORT}.pid"
LOG_FILE="/tmp/review-preview-${PORT}.log"

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "❌ review-preview: $DIST_DIR/index.html 不存在，staging 可能未 build" >&2
  exit 1
fi

# 杀掉同端口旧进程
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
COMMIT=$(git -C "$MAIN_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

DIST_DIR="$DIST_DIR" \
  SLOT_PORT="$PORT" \
  STAGING_BANNER=1 \
  STAGING_FLAG_TEXT="REVIEW #${PR_NUMBER}" \
  STAGING_FLAG_COLOR="#8b5cf6" \
  STAGING_COMMIT="$COMMIT" \
  nohup node "$SLOT_SERVER" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

# 等最多 10s 确认起来了
for _ in $(seq 1 10); do
  curl -sf "http://localhost:${PORT}/" -o /dev/null 2>/dev/null && break
  kill -0 "$NEW_PID" 2>/dev/null || { echo "❌ review-preview 进程异常退出" >&2; cat "$LOG_FILE" >&2; exit 1; }
  sleep 1
done
curl -sf "http://localhost:${PORT}/" -o /dev/null 2>/dev/null || { echo "❌ review-preview 10s 内未就绪" >&2; exit 1; }

echo "✅ review-preview PR #${PR_NUMBER} → http://localhost:${PORT} (PID $NEW_PID)"
