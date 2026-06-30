#!/bin/bash
# preview-cleanup.sh — 预览环境清理脚本
#
# 用法:
#   preview-cleanup.sh <PORT> [BRANCH_NAME]
#
# 通过 PID 文件精确 kill 进程，释放端口

set -e

PORT="${1:-}"
BRANCH_NAME="${2:-}"

if [ -z "$PORT" ]; then
  echo "ERROR: 必须提供 PORT 参数" >&2
  echo "用法: $0 <PORT> [BRANCH_NAME]" >&2
  exit 1
fi

echo "[preview-cleanup] port=$PORT branch=${BRANCH_NAME:-unknown}"

PID_FILE="/tmp/preview-${PORT}.pid"
BRANCH_FILE="/tmp/preview-${PORT}.branch"
LOG_FILE="/tmp/preview-${PORT}.log"

# 通过 PID 文件 kill 进程
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "[preview-cleanup] 停止进程 PID=$PID (port=$PORT)"
    kill "$PID" 2>/dev/null || true
    sleep 1
    # 强制 kill（如果进程还存在）
    kill -9 "$PID" 2>/dev/null || true
  else
    echo "[preview-cleanup] PID=$PID 进程已不存在（已停止）"
  fi
  rm -f "$PID_FILE"
else
  echo "[preview-cleanup] 未找到 PID 文件 $PID_FILE，尝试 pkill 兜底"
  pkill -f "http.server ${PORT}" 2>/dev/null || true
fi

# 清理元数据文件
rm -f "$BRANCH_FILE" "$LOG_FILE"

# 清理部署目录
DEPLOY_DIR="${HOME}/previews/${PORT}"
if [ -d "$DEPLOY_DIR" ]; then
  echo "[preview-cleanup] 删除部署目录 $DEPLOY_DIR"
  rm -rf "$DEPLOY_DIR"
fi

echo "[preview-cleanup] ✅ 端口 $PORT 已释放"
