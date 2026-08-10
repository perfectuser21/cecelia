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

  # 3a/3b. 终止预览进程 —— 只认起环境时记录在案的 PID，绝不用 lsof 猜端口持有者。
  #
  # 事故根因（2026-08-09~10）：旧逻辑按端口查持有者再 SIGKILL（lsof + xargs kill -9），
  # 而 OrbStack vmgr 做容器端口转发、正是预览端口（5300-5302）的持有者 → 每次回收都把
  # OrbStack VM 管理器 SIGKILL 掉 → 全机 docker 中断 → 连锁打死所有 harness run。
  # 正确 PID 早已由 preview-env-start.sh:290 写进 /tmp/preview-<pr>.pid，旧逻辑却删掉它、
  # 改用 lsof 猜。现改为读该 PID，并在 kill 前做两道门：基础设施红线 + 身份校验。
  # 铁律：宁可漏回收进程，不可误杀宿主基础设施。
  PID_FILE="/tmp/preview-${pr}.pid"
  TARGET_PID=""
  [ -f "$PID_FILE" ] && TARGET_PID=$(head -1 "$PID_FILE" 2>/dev/null | tr -d '[:space:]')

  if [ -z "$TARGET_PID" ] || ! [[ "$TARGET_PID" =~ ^[0-9]+$ ]]; then
    # 降级：pid 文件缺失/损坏 —— 绝不回落到杀端口持有者（那正是事故根因）。
    # 仅记日志跳过进程终止，由后续巡检/守护处理；DB/cache/worktree 回收照常进行。
    log "  ⚠ PR#${pr} pid 文件缺失或无效（${PID_FILE}），跳过进程终止（降级：宁可漏回收，不可误杀宿主基础设施）"
  elif ! kill -0 "$TARGET_PID" 2>/dev/null; then
    log "  PR#${pr} 记录的 PID=${TARGET_PID} 进程已不存在，无需终止"
  else
    # 取进程身份：可执行名 + 完整 cmdline（argv）。
    # Linux（CI/fleet-worker）优先读 /proc（本机精简 ps 不支持 -o）；macOS（生产）无 /proc，
    # 回落到 ps -o command=/comm=。两端都能拿到身份，避免因取不到 cmdline 而误判/误杀。
    if [ -r "/proc/${TARGET_PID}/cmdline" ]; then
      PROC_ARGS=$(tr '\0' ' ' < "/proc/${TARGET_PID}/cmdline" 2>/dev/null | tr -d '\n')
      PROC_COMM=$(cat "/proc/${TARGET_PID}/comm" 2>/dev/null | tr -d '\n')
    else
      PROC_ARGS=$(ps -p "$TARGET_PID" -o command= 2>/dev/null | tr -d '\n')
      [ -z "$PROC_ARGS" ] && PROC_ARGS=$(ps -p "$TARGET_PID" -o args= 2>/dev/null | tr -d '\n')
      PROC_COMM=$(ps -p "$TARGET_PID" -o comm= 2>/dev/null | tr -d '\n')
    fi
    PROC_IDENT="${PROC_COMM} ${PROC_ARGS}"

    if echo "$PROC_IDENT" | grep -qiE 'orbstack|vmgr|com\.docker|dockerd|docker-proxy|containerd|/docker|/qemu|qemu-|runc|colima|lima|vpnkit|virtiofsd'; then
      # 红线（不可回归）：命中 OrbStack / docker / 容器运行时 → 绝不 kill，告警。
      log "  🚨 告警：PR#${pr} 记录的 PID=${TARGET_PID} 命中基础设施进程（${PROC_COMM:-?}）— 拒绝 kill（红线：绝不误杀宿主基础设施，见 2026-08-09 OrbStack vmgr 事故）"
    elif ! echo "$PROC_ARGS" | grep -qE "(BRAIN_PREVIEW_PR=${pr}([^0-9]|\$)|preview-${pr}([^0-9]|/|\$))"; then
      # 身份校验：cmdline 必须含本 PR 标识（env 标记或 worktree 路径），否则校验不过一律不杀。
      log "  ⚠ PR#${pr} 记录的 PID=${TARGET_PID} cmdline 未含本 PR 标识，身份校验不过，跳过 kill（保守）：${PROC_ARGS}"
    else
      kill "$TARGET_PID" 2>/dev/null || true
      sleep 1
      kill -9 "$TARGET_PID" 2>/dev/null || true
      log "  ✓ PR#${pr} 预览进程 PID=${TARGET_PID} 已终止"
    fi
  fi
  rm -f "/tmp/preview-${pr}.pid" "/tmp/preview-${pr}.branch" "/tmp/preview-${pr}.log" 2>/dev/null || true

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
