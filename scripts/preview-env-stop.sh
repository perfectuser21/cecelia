#!/usr/bin/env bash
# preview-env-stop.sh — 停止 per-PR 预览环境，清理资源
#
# 调用方：Brain API POST /api/brain/preview/stop/:pr（异步触发）
# 参数：
#   $1  PR_NUMBER  — GitHub PR 编号
#   $2  PORT       — 预览 Brain 端口
#   $3  DB_NAME    — 预览数据库名

set -euo pipefail

PR_NUMBER="${1:?PR_NUMBER 必须提供}"
PORT="${2:?PORT 必须提供}"
DB_NAME="${3:?DB_NAME 必须提供}"

REPO_ROOT="${REPO_ROOT:-/Users/administrator/perfect21/cecelia}"
PREVIEW_BASE_DIR="${PREVIEW_BASE_DIR:-/Users/administrator/worktrees/cecelia-previews}"
WORK_DIR="${PREVIEW_BASE_DIR}/preview-${PR_NUMBER}"
LOG_FILE="/tmp/preview-${PR_NUMBER}-stop.log"
PID_FILE="/tmp/preview-${PR_NUMBER}.pid"

log() { echo "[preview-stop PR#${PR_NUMBER}] $*" | tee -a "$LOG_FILE"; }

log "开始清理预览环境: port=${PORT} db=${DB_NAME}"

# ── 1. 停止 Brain 进程 ────────────────────────────────────────────────────────
log "Step 1: 停止 Brain 进程..."
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 2
    # 强制终止
    kill -9 "$PID" 2>/dev/null || true
    log "  ✓ 进程 PID=${PID} 已停止"
  else
    log "  进程 PID=${PID} 已不存在"
  fi
  rm -f "$PID_FILE"
else
  # PID 文件不存在时，尝试通过��口找进程
  PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null || true
    log "  ✓ 端口 ${PORT} 上的进程已停止"
  else
    log "  端口 ${PORT} 上无进程"
  fi
fi

# ── 2. 删除预览数据库 ─────────────────────────────────────────────────────────
log "Step 2: DROP DATABASE ${DB_NAME}..."
PGPASSWORD="${DB_PASSWORD:-cecelia}" dropdb \
  -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
  --if-exists "$DB_NAME" 2>>"$LOG_FILE" && log "  ✓ 数据库已删除" || log "  ⚠ 数据库删除失败（可能已不存在）"

# ── 3. 清理 git worktree ──────────────────────────────────────────────────────
log "Step 3: 清理 git worktree ${WORK_DIR}..."
if git -C "$REPO_ROOT" worktree list 2>/dev/null | grep -q "$WORK_DIR"; then
  git -C "$REPO_ROOT" worktree remove -f "$WORK_DIR" 2>>"$LOG_FILE" && log "  ✓ worktree 已清理" || log "  ⚠ worktree 清理失败"
fi
rm -rf "$WORK_DIR" 2>/dev/null || true

# ── 4. 清理 log 文件 ──────────────────────────────────────────────────────────
rm -f "/tmp/preview-${PR_NUMBER}.log" 2>/dev/null || true

log "✅ 预览环境清理完成 PR#${PR_NUMBER}"
