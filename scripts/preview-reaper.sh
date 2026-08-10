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

# ── 进程身份工具（2026-08 OrbStack 误杀事故修复）────────────────────────────────
# 事故根因：旧逻辑 `lsof -ti :$PORT | xargs kill -9` 把「端口持有者」当预览进程杀。
# 但 OrbStack 做容器端口转发，转发端口 socket 由其 vmgr helper 持有——于是每次回收
# 都 SIGKILL 掉 OrbStack 虚拟机管理器，引发全机 docker 中断、连锁打死所有 harness run。
# 修复：改读 preview-env-start.sh 记录在案的 /tmp/preview-<pr>.pid，并在 kill 前做
# 双重校验（身份匹配 + 基础设施红线），宁可漏回收，不可误杀宿主基础设施。

# 读取指定 PID 的完整 cmdline（跨平台：macOS 有 ps 无 /proc；Linux CI 有 /proc）。
# 优先 ps（生产 macOS 唯一可用），其次回落 /proc（Linux 容器无 ps 时可用）。
preview_proc_cmdline() {
  local pid="$1" out=""
  if command -v ps >/dev/null 2>&1; then
    out=$(ps -p "$pid" -o command= 2>/dev/null || true)
  fi
  if [ -z "$out" ] && [ -r "/proc/$pid/cmdline" ]; then
    out=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  fi
  printf '%s' "$out"
}

# 红线：命中 OrbStack / docker / 容器运行时一律判为基础设施，任何路径下都不许 kill。
# 按可执行路径前缀 / 进程名判定（大小写不敏感）。
is_infra_process() {
  local cmd="$1"
  echo "$cmd" | grep -qiE 'orbstack|vmgr|com\.docker|dockerd|containerd|docker-proxy|/Docker\.app|Docker Desktop|colima|lima|qemu' \
    && return 0
  return 1
}

# 身份校验：cmdline 必须携带该 PR 的预览工作树标识 preview-<pr>（preview-env-start.sh
# 的 WORK_DIR/BRAIN_SERVER 路径必含此段），或显式 BRAIN_PREVIEW_PR=<pr>。
# 用非数字边界避免 preview-10 误匹配 preview-109。
is_preview_process() {
  local cmd="$1" pr="$2"
  echo "$cmd" | grep -qE "preview-${pr}([^0-9]|$)" && return 0
  echo "$cmd" | grep -qE "BRAIN_PREVIEW_PR[=[:space:]]+${pr}([^0-9]|$)" && return 0
  return 1
}

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

  # 3b. Kill 预览进程（按 PID 文件 + 身份校验 + 基础设施红线；不再用 lsof 杀端口持有者）
  #     旧逻辑 `lsof -ti :$PORT | xargs kill -9` 会误杀 OrbStack vmgr（端口转发持有者），
  #     引发全机 docker 中断。改读起环境时写下的 /tmp/preview-<pr>.pid，见文件顶部工具函数。
  PID_FILE="/tmp/preview-${pr}.pid"
  if [ -f "$PID_FILE" ]; then
    PREVIEW_PID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]' || echo "")
    if [ -n "$PREVIEW_PID" ] && [[ "$PREVIEW_PID" =~ ^[0-9]+$ ]]; then
      PID_CMD=$(preview_proc_cmdline "$PREVIEW_PID")
      if [ -z "$PID_CMD" ]; then
        log "  ⚠ PID ${PREVIEW_PID}（PR#${pr}）进程已不存在，跳过 kill"
      elif is_infra_process "$PID_CMD"; then
        # 红线：命中基础设施进程，任何情况下都不 kill，并告警
        log "  🚨 拒绝 kill：PID ${PREVIEW_PID} 命中基础设施进程（OrbStack/docker/容器运行时），跳过并告警：cmd=${PID_CMD}"
      elif ! is_preview_process "$PID_CMD" "$pr"; then
        # 身份校验不过：cmdline 未携带 preview-<pr> 标识，一律不 kill
        log "  ⚠ PID ${PREVIEW_PID} cmdline 未含 preview-${pr} 标识，身份校验失败，跳过 kill：cmd=${PID_CMD}"
      else
        # 校验通过且非基础设施 → 安全终止
        kill "$PREVIEW_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$PREVIEW_PID" 2>/dev/null || true
        log "  ✓ 预览进程 PID ${PREVIEW_PID}（PR#${pr}）已终止"
      fi
    else
      log "  ⚠ PID 文件 ${PID_FILE} 内容非法（'${PREVIEW_PID}'），跳过 kill"
    fi
  else
    # 降级：PID 文件缺失，绝不回落到「按端口杀持有者」（那正是误杀 OrbStack 的老路）。
    # 仅记日志跳过，宁可漏回收，交后续巡检处理。
    log "  ⚠ PID 文件 ${PID_FILE} 缺失，降级：不按端口 kill 任何进程，交后续巡检处理"
  fi
  rm -f "$PID_FILE" "/tmp/preview-${pr}.branch" "/tmp/preview-${pr}.log" 2>/dev/null || true

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
