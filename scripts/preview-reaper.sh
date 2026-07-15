#!/usr/bin/env bash
# preview-reaper.sh — 预览环境对账回收器（宿主 cron 每小时跑）
# 三源并集找候选 PR：①PREVIEW_BASE_DIR 下 preview-<N> 目录 ②cecelia_preview_<N> 数据库
# ③preview_environments 表 status!=inactive 行。逐个查 GitHub PR 状态：
#   MERGED/CLOSED → kill 端口进程(表里有 port 时) + dropdb + 删目录 + 表行标 inactive
#   OPEN → 不动；状态查询失败 → 不动 + WARN（fail-safe：不确定就不删）
# 背景：preview-cleanup.yml 单发 webhook 在 Brain 不可达窗口丢失且无重试——
# 2026-07-15 实测泄漏 23G worktree + 19 孤儿 DB 致宿主盘满、OrbStack 宕机。
# 用法：preview-reaper.sh [--dry-run]；env 覆盖：PREVIEW_BASE_DIR/REPO/GH_BIN/
#   PSQL_ARGS(默认 "-h localhost -p 5432 -U postgres")/DRY_RUN

set -uo pipefail

PREVIEW_BASE_DIR="${PREVIEW_BASE_DIR:-/Users/administrator/worktrees/cecelia-previews}"
REPO="${REPO:-perfectuser21/cecelia}"
GH_BIN="${GH_BIN:-gh}"
PSQL_ARGS="${PSQL_ARGS:--h localhost -p 5432 -U postgres}"
DRY_RUN="${DRY_RUN:-0}"

for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=1
done

log()  { echo "[preview-reaper] $*"; }
warn() { echo "[preview-reaper] WARN: $*" >&2; }

# ── 三源收集候选 PR 号 ────────────────────────────────────────────────────────
# 源①：PREVIEW_BASE_DIR 下 preview-<N> 目录
DIR_PRS=""
if [ -d "$PREVIEW_BASE_DIR" ]; then
  DIR_PRS=$(ls "$PREVIEW_BASE_DIR" 2>/dev/null | grep -E '^preview-[0-9]+$' | sed 's/^preview-//' || true)
fi

# 源②：cecelia_preview_<N> 数据库
DB_LIST=$(psql $PSQL_ARGS -d postgres -Atc \
  "SELECT datname FROM pg_database WHERE datname LIKE 'cecelia_preview_%'" 2>/dev/null || true)
DB_PRS=$(printf '%s\n' "$DB_LIST" | sed -n 's/^cecelia_preview_\([0-9][0-9]*\)$/\1/p')

# 源③：preview_environments 表 status!=inactive 行（pr|port|db_name）
TABLE_ROWS=$(psql $PSQL_ARGS -d cecelia -Atc \
  "SELECT pr_number||'|'||port||'|'||db_name FROM preview_environments WHERE status <> 'inactive'" 2>/dev/null || true)
TABLE_PRS=$(printf '%s\n' "$TABLE_ROWS" | sed -n 's/^\([0-9][0-9]*\)|.*/\1/p')

CANDIDATES=$(printf '%s\n%s\n%s\n' "$DIR_PRS" "$DB_PRS" "$TABLE_PRS" | grep -E '^[0-9]+$' | sort -un || true)

TOTAL=0; CLEANED=0; KEPT=0; SKIPPED=0

for N in $CANDIDATES; do
  TOTAL=$((TOTAL + 1))

  # PR 状态（fail-safe：查不到就跳过，绝不清理）
  STATE_RAW=$("$GH_BIN" pr view "$N" --repo "$REPO" --json state -q .state 2>/dev/null)
  GH_RC=$?
  STATE=$(printf '%s' "$STATE_RAW" | grep -oE 'MERGED|CLOSED|OPEN' | head -1 || true)
  if [ "$GH_RC" -ne 0 ] || [ -z "$STATE" ]; then
    warn "PR #${N} 状态查询失败（gh rc=${GH_RC}），fail-safe 跳过不清理"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$STATE" = "OPEN" ]; then
    log "PR #${N} OPEN，保留"
    KEPT=$((KEPT + 1))
    continue
  fi

  # MERGED / CLOSED → 清理
  ROW=$(printf '%s\n' "$TABLE_ROWS" | grep -m1 "^${N}|" || true)
  PORT=""; ROW_DB=""
  if [ -n "$ROW" ]; then
    PORT=$(printf '%s' "$ROW" | cut -d'|' -f2)
    ROW_DB=$(printf '%s' "$ROW" | cut -d'|' -f3)
  fi
  DB_NAME="${ROW_DB:-cecelia_preview_${N}}"
  WORK_DIR="${PREVIEW_BASE_DIR}/preview-${N}"

  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] PR #${N} ${STATE} → 将清理: kill 端口 ${PORT:-无} / dropdb ${DB_NAME} / rm -rf ${WORK_DIR} / 表行标 inactive"
    CLEANED=$((CLEANED + 1))
    continue
  fi

  log "PR #${N} ${STATE} → 清理开始"

  # 1. kill 端口进程（表里有 port 时）
  if [ -n "$PORT" ]; then
    PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "$PIDS" | xargs kill 2>/dev/null || true
      log "  端口 ${PORT} 进程已 kill"
    fi
  fi

  # 2. 删数据库（幂等）
  dropdb $PSQL_ARGS --if-exists "$DB_NAME" 2>/dev/null || true
  log "  dropdb --if-exists ${DB_NAME} 完成"

  # 3. 删目录（幂等）
  rm -rf "$WORK_DIR" 2>/dev/null || true
  log "  rm -rf ${WORK_DIR} 完成"

  # 4. 表行标 inactive（仅表里有行时）
  if [ -n "$ROW" ]; then
    psql $PSQL_ARGS -d cecelia -Atc \
      "UPDATE preview_environments SET status='inactive', stopped_at=NOW() WHERE pr_number=${N}" \
      >/dev/null 2>&1 || true
    log "  表行 pr_number=${N} 已标 inactive"
  fi

  CLEANED=$((CLEANED + 1))
done

log "候选 ${TOTAL} 清理 ${CLEANED} 保留 ${KEPT} 跳过(状态未知) ${SKIPPED}"
