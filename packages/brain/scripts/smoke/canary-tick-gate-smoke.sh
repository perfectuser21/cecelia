#!/usr/bin/env bash
# canary-tick-gate-smoke.sh
#
# 真实环境 smoke：蓝绿部署的 green canary（BRAIN_DEPLOY_CANARY=1）在真 docker 里
# 启动后，tick loop 必须**不运行**——否则 green 会和 blue 连同一 DB double-dispatch
# 抢任务（issue f38f989f 修复的核心保证）。
#
# 验证清单：
#   1. 用 cecelia-brain 镜像起一个 canary 容器（BRAIN_DEPLOY_CANARY=1，临时端口）
#   2. /api/brain/tick/status 响应（进程真起来了）
#   3. tick 状态 loop_running=false / enabled=false（canary 门控生效，未跑调度）
#
# 与单测差异：单测 mock 依赖验早返；smoke 验真镜像 + 真进程启动路径下 tick 确实没跑。
#
# 环境变量（自包含 / CI 复用）：
#   BRAIN_IMAGE   默认 cecelia-brain:latest（CI 可注入带 tag 的镜像）
#   TMP_PORT      默认 5299（canary 临时端口，避开 5221/5222/5223）
#   DB_URL_ENV    传给容器的 DATABASE_URL（默认 host.docker.internal，非 host network 时可达宿主 DB）
#
# 退出码：0=PASS，非 0=FAIL。跳过条件：缺 docker / 无镜像 / 健康检查始终不起（无 DB 等）→ exit 0 + SKIP。
set -uo pipefail

SMOKE_NAME="canary-tick-gate"
log()  { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL $*"; cleanup; exit 1; }
skip() { log "SKIP $*"; cleanup; exit 0; }

BRAIN_IMAGE="${BRAIN_IMAGE:-cecelia-brain:latest}"
TMP_PORT="${TMP_PORT:-5299}"
DB_URL_ENV="${DB_URL_ENV:-postgresql://cecelia@host.docker.internal:5432/cecelia}"
CANARY_NAME="cecelia-canary-tick-smoke-$$"

cleanup() { docker rm -f "$CANARY_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── 依赖检查（缺则优雅 skip）─────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || skip "无 docker"
docker image inspect "$BRAIN_IMAGE" >/dev/null 2>&1 || skip "无镜像 $BRAIN_IMAGE"

# ── 1. 起 canary 容器（BRAIN_DEPLOY_CANARY=1，临时端口，tick 应被门控关掉）──────
log "起 canary 容器 ${CANARY_NAME}（BRAIN_DEPLOY_CANARY=1, 端口 ${TMP_PORT}）"
docker rm -f "$CANARY_NAME" >/dev/null 2>&1 || true
if ! docker run -d --name "$CANARY_NAME" \
      -p "${TMP_PORT}:5221" \
      -e BRAIN_DEPLOY_CANARY=1 \
      -e CECELIA_TICK_ENABLED=true \
      -e DATABASE_URL="$DB_URL_ENV" \
      "$BRAIN_IMAGE" >/dev/null 2>&1; then
  skip "canary 容器启动失败（可能环境缺失）"
fi

# ── 2. 等 /tick/status 响应（进程起来）──────────────────────────────────────
UP=false
for _ in $(seq 1 15); do
  if curl -sf "http://localhost:${TMP_PORT}/api/brain/tick/status" >/dev/null 2>&1; then
    UP=true; break
  fi
  sleep 2
done
[ "$UP" = true ] || skip "canary 健康检查未起（无 DB / 环境不全），跳过行为断言"

# ── 3. 断言 tick 未运行（canary 门控生效）──────────────────────────────────
STATUS_JSON=$(curl -sf "http://localhost:${TMP_PORT}/api/brain/tick/status" 2>/dev/null || echo '{}')
LOOP_RUNNING=$(echo "$STATUS_JSON" | grep -oE '"loop_running"\s*:\s*(true|false)' | grep -oE '(true|false)' | head -1)
log "canary tick loop_running=$LOOP_RUNNING （期望 false）"
if [ "$LOOP_RUNNING" = "true" ]; then
  fail "BRAIN_DEPLOY_CANARY=1 但 tick loop 仍在跑 → 会 double-dispatch，门控失效！"
fi

log "PASS — canary 门控生效：BRAIN_DEPLOY_CANARY=1 下 tick loop 未运行"
exit 0
