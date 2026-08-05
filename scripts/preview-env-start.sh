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
# 脚本实例锁：同一 PR 只允许一个 preview-env-start.sh 实例运行。
# 并发场景：re-push 触发新 CI run 时，新 spawn 与上一 CI run 遗留的旧 spawn 同时运行，
# 两者争抢同一 WORK_DIR/DB_NAME 会互相破坏，双方均失败退出（PR#3803 实测三次）。
SCRIPT_LOCK="/tmp/preview-script-lock-${PR_NUMBER}"
if [ -f "$SCRIPT_LOCK" ]; then
  OLD_PID=$(cat "$SCRIPT_LOCK" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[preview-start PR#${PR_NUMBER}] 杀死旧实例 PID=${OLD_PID}..." | tee -a "$LOG_FILE"
    kill "$OLD_PID" 2>/dev/null || true
    for i in 1 2 3 4 5; do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 1
    done
  fi
  rm -f "$SCRIPT_LOCK"
fi
echo "$$" > "$SCRIPT_LOCK"
trap "rm -f '$SCRIPT_LOCK'" EXIT INT TERM

# Brain API 地址（本机）
BRAIN_API="http://localhost:${BRAIN_PORT:-5221}"

log() { echo "[preview-start PR#${PR_NUMBER}] $*" | tee -a "$LOG_FILE"; }

log "开始启动预览环境: branch=${BRANCH_NAME} port=${PORT} db=${DB_NAME}"

# ── 0. 停止上一轮遗留的常驻 Brain 进程 ──────────────────────────────────────────
# 必须在 Step 4（数据库克隆）之前完成，且必须等待确认真正退出（SIGKILL 兜底）。
# 上一轮 preview-env-start.sh 脚本本身跑完就退出了（SCRIPT_LOCK 已释放），但它
# nohup 启动的 Brain 子进程是预期常驻的（预览环境要一直活到 PR 关闭），仍连着
# 同名 ${DB_NAME}。若这一步拖到 Step 5（原位置）才做，re-push 间隔较短时旧进程
# 还没被杀，Step 4 的 dropdb 会报 "is being accessed by other users"，createdb
# 因库已存在报错，脚本 exit 1，Brain API status 永远停留 starting，GHA 只能
# 傻等两层硬编码超时（600s 轮询 + 120s 健康检查 ≈ 12min）才报错（PR#4176 CI 实测复现）。
if [ -f "$PID_FILE" ]; then
  OLD_BRAIN_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$OLD_BRAIN_PID" ] && kill -0 "$OLD_BRAIN_PID" 2>/dev/null; then
    log "Step 0: 停止上一轮遗留 Brain 进程 PID=${OLD_BRAIN_PID}..."
    kill "$OLD_BRAIN_PID" 2>/dev/null || true
    for i in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$OLD_BRAIN_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$OLD_BRAIN_PID" 2>/dev/null; then
      log "  ⚠ ${OLD_BRAIN_PID} 10s 内未退出，SIGKILL 兜底"
      kill -9 "$OLD_BRAIN_PID" 2>/dev/null || true
      sleep 1
    fi
    log "  ✓ 上一轮 Brain 进程已停止"
  fi
  rm -f "$PID_FILE"
fi

# ── 1. git worktree ──────────────────────────────────────────────────────────
log "Step 1: git worktree 检出 ${BRANCH_NAME}..."
# 如果已存在先清理（幂等，支持 re-push 场景）
if git -C "$REPO_ROOT" worktree list | grep -q "$WORK_DIR"; then
  git -C "$REPO_ROOT" worktree remove -f "$WORK_DIR" 2>/dev/null || true
fi
rm -rf "$WORK_DIR"

git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
git -C "$REPO_ROOT" fetch origin "${BRANCH_NAME}" 2>>"$LOG_FILE" || {
  log "ERROR: git fetch origin ${BRANCH_NAME} 失败"
  exit 1
}
git -C "$REPO_ROOT" worktree add "$WORK_DIR" "origin/${BRANCH_NAME}" 2>>"$LOG_FILE" || {
  log "ERROR: git worktree add 失败"
  exit 1
}
log "  ✓ worktree 创建完成: ${WORK_DIR}"

# ── 2. 构建前端 ───────────────────────────────────────────────────────────────
# 在干净 worktree（无 packages/brain/node_modules symlink）中构建前端。
# 关键约束：/repo/packages/brain/node_modules 在容器镜像内是只读的。
# 若先建了 packages/brain/node_modules → /repo/packages/brain/node_modules symlink，
# 再跑 npm ci，npm workspace resolve 会尝试 rmdir/写入该只读路径，
# 导致 EROFS: read-only file system（PR#3812 实测）。
# 解法：npm cache 显式指定到 /tmp 下（避免默认 ~/.npm ENOENT），且先构建后链接。
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

# ── 3. 准备 Brain 运行时依赖 ─────────────────────────────────────────────────
# 快路径复用镜像依赖，但前提是镜像内烙入的根 package-lock 与 PR 完全相同。
# 不能只看 node_modules 是否存在：PR 新增生产依赖时，旧镜像目录仍然存在却缺包，
# Brain 会在启动后报 ERR_MODULE_NOT_FOUND，preview 状态卡在 starting 直到 CI 超时。
# lock 不同或镜像没有 lock 时，在干净 worktree 根按 Brain workspace 做 npm ci；这既
# 使用 PR 的根 lock，又避免从 packages/brain 子目录执行时误用陈旧的子 package-lock。
log "Step 3: 准备 Brain 运行时依赖..."
BRAIN_NM_TARGET="${BRAIN_NM_TARGET:-/repo/node_modules}"
BRAIN_BRAIN_NM_TARGET="${BRAIN_BRAIN_NM_TARGET:-/repo/packages/brain/node_modules}"
BRAIN_LOCK_TARGET="${BRAIN_LOCK_TARGET:-/repo/package-lock.json}"

# 旧镜像没有烙 root lock 时无法证明依赖与源码匹配，必须走隔离安装。只有整个
# /repo 依赖目录不存在时才退回 deploy root；不能拿 deploy root 的 lock 给镜像背书。
if [ ! -d "$BRAIN_NM_TARGET" ] && [ -d "${REPO_ROOT}/node_modules" ]; then
  BRAIN_NM_TARGET="${REPO_ROOT}/node_modules"
  BRAIN_BRAIN_NM_TARGET="${REPO_ROOT}/packages/brain/node_modules"
  BRAIN_LOCK_TARGET="${REPO_ROOT}/package-lock.json"
fi

rm -rf "${WORK_DIR}/node_modules" "${WORK_DIR}/packages/brain/node_modules"
if [ -d "$BRAIN_NM_TARGET" ] \
    && [ -f "$BRAIN_LOCK_TARGET" ] \
    && cmp -s "${WORK_DIR}/package-lock.json" "$BRAIN_LOCK_TARGET"; then
  ln -sfn "$BRAIN_NM_TARGET" "${WORK_DIR}/node_modules"
  log "  ✓ 根 lock 一致，复用镜像 node_modules → ${BRAIN_NM_TARGET}"
  if [ -d "$BRAIN_BRAIN_NM_TARGET" ]; then
    ln -sfn "$BRAIN_BRAIN_NM_TARGET" "${WORK_DIR}/packages/brain/node_modules"
    log "  ✓ Brain node_modules 已链接 → ${BRAIN_BRAIN_NM_TARGET}"
  fi
else
  NPM_LOGS_DIR="${PREVIEW_BASE_DIR}/.npm-logs-preview-${PR_NUMBER}"
  mkdir -p "$NPM_LOGS_DIR"
  log "  根 lock 与镜像不一致或镜像无依赖指纹，安装 PR 的 Brain 生产依赖..."
  if (cd "$WORK_DIR" && npm ci --workspace=packages/brain \
      --omit=dev --omit=optional --ignore-scripts \
      --cache "$NPM_CACHE_DIR" --logs-dir "$NPM_LOGS_DIR" \
      >> "$LOG_FILE" 2>&1); then
    log "  ✓ PR Brain 生产依赖安装完成"
  else
    log "ERROR: PR Brain 生产依赖安装失败，拒绝用旧镜像依赖启动"
    exit 1
  fi
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

# ── 4.5 灭活克隆快照里的生产 harness 任务 ────────────────────────────────────
# 预览库是生产库整库快照，携带 in_progress/queued 的 harness_initiative 任务。
# 预览 Brain 启动时 startup-sync 会把它们当孤儿"恢复"，spawn 出自己的 Kernel
# orchestrator——与生产 Brain 共用同一 fleet-worker bridge token/工作区分支/回调
# 地址，两个大脑争抢同一 run（2026-08-05 preview-4643 实测毒死生产验证 run）。
# 双层防御第一层：克隆完成后立即把这些任务置为终态（第二层是 Brain 侧
# BRAIN_PREVIEW spawn 拒绝闸，见 harness-skill-relay.js）。
log "Step 4.5: 灭活克隆快照中的活跃 harness 任务..."
NEUTRALIZED=$(PGPASSWORD="${DB_PASSWORD:-cecelia}" psql   -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" -d "$DB_NAME" -tAc   "UPDATE tasks SET status='failed', result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('reason','preview_clone_neutralized') WHERE task_type='harness_initiative' AND status IN ('queued','in_progress') RETURNING id"   2>>"$LOG_FILE" | grep -c . || true)
log "  ✓ 已灭活 ${NEUTRALIZED:-0} 条克隆 harness 任务"

# ── 5. 启动预览 Brain ─────────────────────────────────────────────────────────
# 上一轮遗留进程已在 Step 0（数据库克隆之前）停止，这里不再重复处理。
log "Step 5: 启动预览 Brain on port=${PORT}..."

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
log "Step 6: 等待 Brain 健康 (max 600s)..."
MAX_WAIT=600
INTERVAL=5
ELAPSED=0
HEALTH_URL="http://localhost:${PORT}/"
while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  # python3 在容器内不一定可用（PR#3803 实测），改用 grep 提取 "status":"running"
  STATUS=$(curl -sf --connect-timeout 3 --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -o '"status":"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"' 2>/dev/null || echo "")
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
  # Brain 未就绪 — 状态保持 starting，CI 会超时后报错
  exit 1
fi

# ── 7. 回写 Brain API 状态（仅 Brain 健康时才 active）────────────────────────
log "Step 7: Brain 健康，回写 preview 状态为 active..."

# 直接用 DB 更新（比 API 更可靠，避免同一机器上不同 Brain 实例的 5221 响应问题）
PGPASSWORD="${DB_PASSWORD:-cecelia}" psql \
  -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" cecelia \
  -c "UPDATE preview_environments SET status='active', updated_at=NOW() WHERE pr_number=${PR_NUMBER} AND status<>'inactive';" \
  2>>"$LOG_FILE" || log "⚠ DB 状态更新失败（非致命）"

log "✅ 预览环境启动完成: http://localhost:${PORT}/"
echo "PREVIEW_URL=http://localhost:${PORT}/"
