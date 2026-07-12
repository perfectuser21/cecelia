#!/usr/bin/env bash
# preview-env-start.sh — 在 US VPS 上启动完整 per-PR 预览环境
#
# 调用方：Brain API POST /api/brain/preview/start（异步触发）
# 参数：
#   $1  PR_NUMBER    — GitHub PR 编号
#   $2  BRANCH_NAME  — PR 分支名
#   $3  PORT         — 预览 Brain 端口（5300-5399）
#   $4  DB_NAME      — 预览数据库名（cecelia_preview_<PR>）
#
# 完成后调 Brain API 把 preview 状态改为 active。
#
# 架构：
#   1. git worktree add 检出 PR 代码
#   2. CREATE DATABASE ... TEMPLATE cecelia 克隆生产快照（隔离数据）
#   3. 构建前端（worktree 内独立 npm ci，含 devDeps）
#   4. 以预览端口 + 预览 DB + 前端 dist 目录启动 Brain 进程

set -euo pipefail

PR_NUMBER="${1:?PR_NUMBER 必须提供}"
BRANCH_NAME="${2:?BRANCH_NAME 必须提供}"
PORT="${3:?PORT 必须提供}"
DB_NAME="${4:?DB_NAME 必须提供}"

# 找主仓库（Brain container 内 REPO_ROOT 指向 deploy root；宿主直调走 git）
REPO_ROOT="${REPO_ROOT:-/Users/administrator/perfect21/cecelia}"
# 容器 /tmp 是 tmpfs:size=100M（docker-compose.yml read_only 安全边界），前端全量 npm ci
# （含 devDeps，几百 MB）会撑爆导致 ENOSPC（PR#3807 实测）。worktree 挪到
# /Users/administrator/worktrees（docker-compose 已 rw 挂载，宿主真实磁盘，非 tmpfs）。
PREVIEW_BASE_DIR="${PREVIEW_BASE_DIR:-/Users/administrator/worktrees/cecelia-previews}"
mkdir -p "$PREVIEW_BASE_DIR"
WORK_DIR="${PREVIEW_BASE_DIR}/preview-${PR_NUMBER}"
LOG_FILE="/tmp/preview-${PR_NUMBER}.log"
PID_FILE="/tmp/preview-${PR_NUMBER}.pid"

# Brain API 地址（本机）
BRAIN_API="http://localhost:${BRAIN_PORT:-5221}"

log() { echo "[preview-start PR#${PR_NUMBER}] $*" | tee -a "$LOG_FILE"; }

log "开始启动预览环境: branch=${BRANCH_NAME} port=${PORT} db=${DB_NAME}"

# ── 1. git worktree ──────────────────────────────────────────────────────────
log "Step 1: git worktree 检出 ${BRANCH_NAME}..."
# 如果已存在先清理（幂等，支持 re-push 场景）
if git -C "$REPO_ROOT" worktree list | grep -q "$WORK_DIR"; then
  git -C "$REPO_ROOT" worktree remove -f "$WORK_DIR" 2>/dev/null || true
fi
rm -rf "$WORK_DIR"

git -C "$REPO_ROOT" fetch origin "${BRANCH_NAME}" 2>>"$LOG_FILE" || {
  log "ERROR: git fetch origin ${BRANCH_NAME} 失败"
  exit 1
}
git -C "$REPO_ROOT" worktree add "$WORK_DIR" "origin/${BRANCH_NAME}" 2>>"$LOG_FILE" || {
  log "ERROR: git worktree add 失败"
  exit 1
}
log "  ✓ worktree 创建完成: ${WORK_DIR}"

# ── 2. 前端构建 ───────────────────────────────────────────────────────────────
# 注意：先构建前端，再建 Brain node_modules symlink。
# 原因：/repo/packages/brain/node_modules 在容器镜像内是只读的。
# 若在 npm ci 前就建了 packages/brain/node_modules → /repo/packages/brain/node_modules，
# npm workspace resolve 时会尝试 rmdir/写入该只读路径，导致 EROFS（PR#3812 实测）。
# 方案：前端构建在干净 worktree（无 brain node_modules symlink）中单独 npm ci。
log "Step 2: 构建 apps/dashboard（dashboard 目录独立 npm ci，含 devDeps）..."
DASH_DIR="${WORK_DIR}/apps/dashboard"
DIST_DIR="${DASH_DIR}/dist"
NPM_CACHE_DIR="${PREVIEW_BASE_DIR}/.npm-cache-preview-${PR_NUMBER}"
mkdir -p "$NPM_CACHE_DIR"

if (cd "$DASH_DIR" && npm ci --cache "$NPM_CACHE_DIR" >> "$LOG_FILE" 2>&1 \
    && npm run build >> "$LOG_FILE" 2>&1); then
  log "  ✓ 前端构建完成: ${DIST_DIR}"
else
  log "  ⚠ 前端构建失败，预览 Brain 将无 UI（API 仍可用）"
  DIST_DIR=""
fi

# ── 3. node_modules symlink（Brain 运行时用，生产依赖即可）────────────────────
# 在前端构建完成后再建 Brain node_modules symlink，避免 npm ci 触碰只读路径。
# 优先用容器镜像内置的 /repo/node_modules（npm ci --omit=dev 构建，包含 Brain 全部生产依赖）。
log "Step 3: 链接 node_modules（Brain 运行时）..."
BRAIN_NM_TARGET="/repo/node_modules"
BRAIN_BRAIN_NM_TARGET="/repo/packages/brain/node_modules"
if [ ! -d "$BRAIN_NM_TARGET" ] && [ -d "${REPO_ROOT}/node_modules" ]; then
  BRAIN_NM_TARGET="${REPO_ROOT}/node_modules"
  BRAIN_BRAIN_NM_TARGET="${REPO_ROOT}/packages/brain/node_modules"
fi
ln -sfn "$BRAIN_NM_TARGET" "${WORK_DIR}/node_modules"
log "  ✓ 根 node_modules 已链接 → ${BRAIN_NM_TARGET}"
if [ -d "$BRAIN_BRAIN_NM_TARGET" ]; then
  ln -sfn "$BRAIN_BRAIN_NM_TARGET" "${WORK_DIR}/packages/brain/node_modules"
  log "  ✓ Brain node_modules 已链接 → ${BRAIN_BRAIN_NM_TARGET}"
fi

# ── 4. 克隆生产数据库 ─────────────────────────────────────────────────────────
# createdb -T cecelia（CREATE DATABASE...TEMPLATE）要求模板库无活跃连接，
# 但 cecelia 是持续在跑的生产库（Brain 自己一直连着），这个前提永远不成立，
# 实测必现 "source database is being accessed by other users"（PR#3809验证发现）。
# 改用 pg_dump | pg_restore 管道直传：不依赖模板库无连接，也不落盘（避免容器 tmpfs 限制）。
# 临时方案——2.5GB 库约 50s+，后续用定期刷新的无连接快照库当 TEMPLATE 做真正的快速克隆（另立任务）。
log "Step 4: 克隆数据库 cecelia → ${DB_NAME}（pg_dump|pg_restore）..."
# 先检查/删除旧库（幂等）
PGPASSWORD="${DB_PASSWORD:-cecelia}" dropdb \
  -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
  --if-exists "$DB_NAME" 2>>"$LOG_FILE" || true

PGPASSWORD="${DB_PASSWORD:-cecelia}" createdb \
  -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
  "$DB_NAME" 2>>"$LOG_FILE" || {
  log "ERROR: createdb ${DB_NAME} 失败"
  exit 1
}

if PGPASSWORD="${DB_PASSWORD:-cecelia}" pg_dump \
    -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" -Fc cecelia 2>>"$LOG_FILE" \
    | PGPASSWORD="${DB_PASSWORD:-cecelia}" pg_restore \
      -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
      --no-owner --no-acl -d "$DB_NAME" 2>>"$LOG_FILE"; then
  log "  ✓ 数据库 ${DB_NAME} 克隆完成"
else
  # pg_restore 对非致命警告（如已存在的扩展/权限对象）也会返回非0，只有目标库确实为空表才算真失败
  TABLE_COUNT=$(PGPASSWORD="${DB_PASSWORD:-cecelia}" psql -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
    -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>>"$LOG_FILE" || echo 0)
  if [ "${TABLE_COUNT:-0}" -gt 0 ]; then
    log "  ⚠ pg_restore 有非致命警告，但 ${DB_NAME} 已有 ${TABLE_COUNT} 张表，视为成功"
  else
    log "ERROR: pg_dump|pg_restore 克隆 ${DB_NAME} 失败（目标库无表）"
    exit 1
  fi
fi

# ── 5. 启动预览 Brain ─────────────────────────────────────────────────────────
log "Step 5: 启动预览 Brain on port=${PORT}..."

# 停止可能残留的旧进程
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  kill "$OLD_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

DB_URL="postgresql://${DB_USER:-cecelia}:${DB_PASSWORD:-cecelia}@${DB_HOST:-localhost}/${DB_NAME}"
BRAIN_SERVER="${WORK_DIR}/packages/brain/server.js"

PREVIEW_STATIC_DIR_ENV=""
if [ -n "$DIST_DIR" ] && [ -d "$DIST_DIR" ]; then
  PREVIEW_STATIC_DIR_ENV="PREVIEW_STATIC_DIR=${DIST_DIR}"
fi

nohup env \
  PORT="$PORT" \
  DATABASE_URL="$DB_URL" \
  DB_NAME="$DB_NAME" \
  DB_HOST="${DB_HOST:-localhost}" \
  DB_USER="${DB_USER:-cecelia}" \
  DB_PASSWORD="${DB_PASSWORD:-cecelia}" \
  BRAIN_PORT="$PORT" \
  BRAIN_PREVIEW=1 \
  BRAIN_PREVIEW_PR="$PR_NUMBER" \
  ${PREVIEW_STATIC_DIR_ENV} \
  SKIP_MIGRATIONS=false \
  CECELIA_TICK_ENABLED=false \
  GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
  node "${BRAIN_SERVER}" \
  >> "$LOG_FILE" 2>&1 &

BRAIN_PID=$!
echo "$BRAIN_PID" > "$PID_FILE"
log "  Brain PID=${BRAIN_PID} 已写入 ${PID_FILE}"

# ── 6. 等待 Brain 健康 ────────────────────────────────────────────────────────
log "Step 6: 等待 Brain 健康 (max 120s)..."
MAX_WAIT=120
INTERVAL=5
ELAPSED=0
HEALTH_URL="http://localhost:${PORT}/"
while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  STATUS=$(curl -sf --connect-timeout 3 --max-time 5 "$HEALTH_URL" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "running" ]; then
    log "  ✓ Brain 健康 (${ELAPSED}s)"
    break
  fi
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ "$STATUS" != "running" ]; then
  log "ERROR: Brain 在 ${MAX_WAIT}s 内未就绪，最后 10 行日志:"
  tail -10 "$LOG_FILE" >&2
  # Brain 未就绪 — 保持 starting 状态，CI 轮询超时后报错
  exit 1
fi

# ── 7. 回写 Brain API 状态（仅 Brain 健康时才 active）────────────────────────
log "Step 7: Brain 健康，回写 preview 状态为 active..."

# 直接用 DB 更新（比 API 可靠：避免同机器不同 Brain 实例的 5221 响应问题）
PGPASSWORD="${DB_PASSWORD:-cecelia}" psql \
  -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" cecelia \
  -c "UPDATE preview_environments SET status='active', updated_at=NOW() WHERE pr_number=${PR_NUMBER};" \
  2>>"$LOG_FILE" || log "⚠ DB 状态更新失败（非致命）"

log "✅ 预览环境启动完成: http://localhost:${PORT}/"
echo "PREVIEW_URL=http://localhost:${PORT}/"
