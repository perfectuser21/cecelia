#!/usr/bin/env bash
# preview-reaper.sh — 预览环境三源对账器
#
# 四源并集：PREVIEW_BASE_DIR 目录 / 独立 npm cache / cecelia_preview_* DB /
# preview_environments 表（非 inactive）
# 对每个 PR 查 gh pr view --json state；MERGED/CLOSED → 回收；状态查询失败 → 跳过（保守）
#
# 用法：
#   bash scripts/preview-reaper.sh [--dry-run]
#
# 环境变量：
#   PREVIEW_BASE_DIR  (默认 /Users/administrator/worktrees/cecelia-previews)
#   REPO_ROOT         (默认 /Users/administrator/perfect21/cecelia)
#   DB_HOST / DB_USER / DB_PASSWORD
#   GH_REPO           (默认自动从 git remote 推断，例如 owner/repo)

set -uo pipefail

# cron 默认 PATH 只有 /usr/bin:/bin，找不到装在 /opt/homebrew/bin 的 gh/psql/dropdb，
# 导致 gh pr view 在 cron 下 100% 失败、"保守跳过"分支永远命中，dropdb 从未被真正执行过
# （2026-07-20 磁盘几乎打满事故根因，见 test 8 in preview-reaper.test.sh）。
# 追加而非前插：不能抢在调用方已设置的 PATH（含测试 mock 目录）前面。
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

PREVIEW_BASE_DIR="${PREVIEW_BASE_DIR:-/Users/administrator/worktrees/cecelia-previews}"
REPO_ROOT="${REPO_ROOT:-/Users/administrator/perfect21/cecelia}"
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-cecelia}"
DB_PASSWORD="${DB_PASSWORD:-cecelia}"
GH_REPO="${GH_REPO:-}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

export PGPASSWORD="$DB_PASSWORD"

log() { echo "[reaper $(date '+%H:%M:%S')] $*"; }

# ── 1. 推断 GH_REPO ──────────────────────────────────────────────────────────
if [ -z "$GH_REPO" ] && [ -d "$REPO_ROOT" ]; then
  GH_REPO=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null \
    | sed -E 's#.*github\.com[:/](.+)(\.git)?$#\1#' \
    | sed 's/\.git$//' || echo "")
fi

# ── 2. 收集三源 PR 编号（写入临时文件去重；回避 bash 5.2 空关联数组 unbound bug）
PR_LIST_FILE=$(mktemp)
trap 'rm -f "$PR_LIST_FILE"' EXIT

# 源 A：PREVIEW_BASE_DIR 目录（preview-<PR> 子目录）
if [ -d "$PREVIEW_BASE_DIR" ]; then
  for d in "$PREVIEW_BASE_DIR"/preview-*/; do
    [ -d "$d" ] || continue
    pr=$(basename "$d" | sed 's/^preview-//')
    [[ "$pr" =~ ^[0-9]+$ ]] && echo "$pr" >>"$PR_LIST_FILE"
  done
fi

# 源 B：每个预览独立的 npm cache（.npm-cache-preview-<PR>）。预览 worktree 或
# 数据库已被其他路径清掉时，cache 仍必须能单独进入对账，否则会永久泄漏。
if [ -d "$PREVIEW_BASE_DIR" ]; then
  for d in "$PREVIEW_BASE_DIR"/.npm-cache-preview-*/; do
    [ -d "$d" ] || continue
    pr=$(basename "$d" | sed 's/^\.npm-cache-preview-//')
    [[ "$pr" =~ ^[0-9]+$ ]] && echo "$pr" >>"$PR_LIST_FILE"
  done
fi

# 源 C：cecelia_preview_* 数据库
psql -h "$DB_HOST" -U "$DB_USER" -t -A \
  -c "SELECT datname FROM pg_database WHERE datname LIKE 'cecelia_preview_%';" 2>/dev/null \
  | grep -E '^cecelia_preview_[0-9]+$' \
  | sed 's/^cecelia_preview_//' >>"$PR_LIST_FILE" || true

# 源 D：preview_environments 表（非 inactive）
psql -h "$DB_HOST" -U "$DB_USER" -d cecelia -t -A \
  -c "SELECT DISTINCT pr_number FROM preview_environments WHERE status != 'inactive';" 2>/dev/null \
  | grep -E '^[0-9]+$' >>"$PR_LIST_FILE" || true

# 去重排序
UNIQUE_PRS=$(sort -un "$PR_LIST_FILE" | tr '\n' ' ' | sed 's/ *$//')

if [ -z "$UNIQUE_PRS" ]; then
  log "没有找到任何预览环境，退出"
  exit 0
fi

PR_COUNT=$(echo "$UNIQUE_PRS" | wc -w | tr -d ' ')
log "发现 ${PR_COUNT} 个 PR 需要对账：${UNIQUE_PRS}"
$DRY_RUN && log "[dry-run 模式] 只打印，不实际回收"

# ── 3. 逐 PR 判断并回收 ──────────────────────────────────────────────────────
CLEANED=0
SKIPPED=0

for pr in $UNIQUE_PRS; do
  log "检查 PR#${pr}..."

  # 查 PR 状态（失败 → 保守跳过，不动资源）
  if [ -n "$GH_REPO" ]; then
    PR_STATE=$(gh pr view "$pr" --repo "$GH_REPO" --json state --jq '.state' 2>/dev/null || echo "")
  else
    PR_STATE=$(gh pr view "$pr" --json state --jq '.state' 2>/dev/null || echo "")
  fi

  if [ -z "$PR_STATE" ]; then
    log "  ⚠ PR#${pr} 状态查询失败，跳过（保守策略）"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$PR_STATE" != "MERGED" ] && [ "$PR_STATE" != "CLOSED" ]; then
    log "  PR#${pr} 状态=${PR_STATE}，跳过（仍活跃）"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  log "  PR#${pr} 状态=${PR_STATE}，开始回收..."

  if $DRY_RUN; then
    log "  [dry-run] 跳过实际回收"
    CLEANED=$((CLEANED + 1))
    continue
  fi

  # 3a. 从表中查端口（用于 kill 进程）
  PORT=$(psql -h "$DB_HOST" -U "$DB_USER" -d cecelia -t -A \
    -c "SELECT port FROM preview_environments WHERE pr_number = $pr ORDER BY created_at DESC LIMIT 1;" \
    2>/dev/null | head -1 | tr -d '[:space:]' || echo "")

  # 3b. Kill 端口进程
  if [ -n "$PORT" ] && [[ "$PORT" =~ ^[0-9]+$ ]]; then
    PIDS=$(lsof -ti :"$PORT" 2>/dev/null || echo "")
    if [ -n "$PIDS" ]; then
      echo "$PIDS" | xargs kill 2>/dev/null || true
      sleep 1
      echo "$PIDS" | xargs kill -9 2>/dev/null || true
      log "  ✓ 端口 ${PORT} 进程已终止"
    fi
    rm -f "/tmp/preview-${pr}.pid" "/tmp/preview-${pr}.branch" "/tmp/preview-${pr}.log" 2>/dev/null || true
  fi

  # 3c. Drop 数据库
  DB_NAME="cecelia_preview_${pr}"
  DB_EXISTS=$(psql -h "$DB_HOST" -U "$DB_USER" -t -A \
    -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';" 2>/dev/null | head -1 | tr -d '[:space:]' || echo "")
  if [ "$DB_EXISTS" = "1" ]; then
    if dropdb -h "$DB_HOST" -U "$DB_USER" --if-exists "$DB_NAME" 2>/dev/null; then
      log "  ✓ 数据库 ${DB_NAME} 已删除"
    else
      log "  ⚠ 数据库 ${DB_NAME} 删除失败"
    fi
  fi

  # 3d. 清理 worktree 目录
  WORK_DIR="${PREVIEW_BASE_DIR}/preview-${pr}"
  if [ -d "$WORK_DIR" ]; then
    if [ -d "$REPO_ROOT/.git" ]; then
      git -C "$REPO_ROOT" worktree remove -f "$WORK_DIR" 2>/dev/null || true
    fi
    rm -rf "$WORK_DIR" 2>/dev/null || true
    log "  ✓ worktree 目录 ${WORK_DIR} 已删除"
  fi

  # 3e. 清理预览专属 npm cache（不依赖 worktree 是否仍存在）
  NPM_CACHE_DIR="${PREVIEW_BASE_DIR}/.npm-cache-preview-${pr}"
  if [ -d "$NPM_CACHE_DIR" ]; then
    rm -rf -- "$NPM_CACHE_DIR"
    log "  ✓ npm cache ${NPM_CACHE_DIR} 已删除"
  fi

  # 3f. 标记表为 inactive
  psql -h "$DB_HOST" -U "$DB_USER" -d cecelia \
    -c "UPDATE preview_environments SET status='inactive', updated_at=NOW() WHERE pr_number=${pr};" \
    2>/dev/null && log "  ✓ 表状态已更新为 inactive" || \
    log "  ⚠ 表状态更新失败（Brain DB 可能未运行）"

  log "  ✅ PR#${pr} 回收完成"
  CLEANED=$((CLEANED + 1))
done

log "完成：回收 ${CLEANED}，跳过 ${SKIPPED}"
