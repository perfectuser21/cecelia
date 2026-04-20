#!/usr/bin/env bash
# Harness v2 M5 — Final E2E 环境启动脚本
#
# 起真实三件套（非 mock）：
#   - Postgres   端口 55432（独立 DB cecelia_e2e，避免冲突）
#   - Brain      端口 5222 （BRAIN_EVALUATOR_MODE=false）
#   - Frontend   端口 5174 （apps/dashboard vite dev）
#
# PRD: docs/design/harness-v2-prd.md §5.7 Final E2E Runner · §6.4 真实环境
#
# Usage:
#   bash scripts/harness-e2e-up.sh [--skip-frontend]
# 退出码：
#   0  全部就绪
#   非 0  任一组件起不来

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --skip-frontend) SKIP_FRONTEND=1 ;;
  esac
done

E2E_COMPOSE="${E2E_COMPOSE:-docker-compose.e2e.yml}"
E2E_DB_HOST="${E2E_DB_HOST:-localhost}"
E2E_DB_PORT="${E2E_DB_PORT:-55432}"
E2E_DB_NAME="${E2E_DB_NAME:-cecelia_e2e}"
E2E_DB_USER="${E2E_DB_USER:-cecelia}"
E2E_DB_PASSWORD="${E2E_DB_PASSWORD:-cecelia}"
E2E_BRAIN_PORT="${E2E_BRAIN_PORT:-5222}"
E2E_FRONTEND_PORT="${E2E_FRONTEND_PORT:-5174}"
E2E_HEALTH_TIMEOUT="${E2E_HEALTH_TIMEOUT:-60}"   # 秒

echo "[harness-e2e-up] starting staging env @ PG=$E2E_DB_PORT Brain=$E2E_BRAIN_PORT Frontend=$E2E_FRONTEND_PORT"

# 1. Postgres（端口 55432）
echo "[harness-e2e-up] starting postgres via $E2E_COMPOSE"
if ! docker compose -f "$E2E_COMPOSE" up -d postgres; then
  echo "[harness-e2e-up] docker compose up failed" >&2
  exit 1
fi

# 2. 等 PG 就绪（pg_isready 轮询）
echo "[harness-e2e-up] waiting for postgres readiness (max ${E2E_HEALTH_TIMEOUT}s)"
elapsed=0
until PGPASSWORD="$E2E_DB_PASSWORD" pg_isready -h "$E2E_DB_HOST" -p "$E2E_DB_PORT" -U "$E2E_DB_USER" >/dev/null 2>&1; do
  sleep 2
  elapsed=$((elapsed + 2))
  if [ "$elapsed" -ge "$E2E_HEALTH_TIMEOUT" ]; then
    echo "[harness-e2e-up] postgres NOT ready after ${E2E_HEALTH_TIMEOUT}s" >&2
    exit 2
  fi
done
echo "[harness-e2e-up] postgres ready"

# 3. 跑迁移（基于当前 main 分支代码）
export DATABASE_URL="postgres://${E2E_DB_USER}:${E2E_DB_PASSWORD}@${E2E_DB_HOST}:${E2E_DB_PORT}/${E2E_DB_NAME}"
echo "[harness-e2e-up] applying migrations to $E2E_DB_NAME"
if ! (cd packages/brain && npm run migrate 2>&1); then
  echo "[harness-e2e-up] migrate failed" >&2
  exit 3
fi

# 4. 起 Brain 5222（BRAIN_EVALUATOR_MODE=false）
echo "[harness-e2e-up] starting Brain @ port $E2E_BRAIN_PORT"
BRAIN_LOG="/tmp/brain-${E2E_BRAIN_PORT}.log"
(
  cd packages/brain
  BRAIN_PORT="$E2E_BRAIN_PORT" \
  DATABASE_URL="$DATABASE_URL" \
  BRAIN_EVALUATOR_MODE=false \
  CECELIA_TICK_ENABLED=false \
    nohup node server.js > "$BRAIN_LOG" 2>&1 &
  echo $! > /tmp/brain-${E2E_BRAIN_PORT}.pid
)

# 5. 等 Brain health
elapsed=0
until curl -sf "http://localhost:${E2E_BRAIN_PORT}/api/brain/tick/status" >/dev/null 2>&1; do
  sleep 2
  elapsed=$((elapsed + 2))
  if [ "$elapsed" -ge "$E2E_HEALTH_TIMEOUT" ]; then
    echo "[harness-e2e-up] Brain $E2E_BRAIN_PORT NOT ready after ${E2E_HEALTH_TIMEOUT}s, log=$BRAIN_LOG" >&2
    exit 4
  fi
done
echo "[harness-e2e-up] Brain ready @ $E2E_BRAIN_PORT"

# 6. 起 Frontend 5174（可跳过，CI-only E2E 不起前端）
if [ "$SKIP_FRONTEND" -ne 1 ]; then
  echo "[harness-e2e-up] starting Frontend @ port $E2E_FRONTEND_PORT"
  FE_LOG="/tmp/frontend-${E2E_FRONTEND_PORT}.log"
  (
    cd apps/dashboard
    PORT="$E2E_FRONTEND_PORT" \
      nohup npm run dev -- --port "$E2E_FRONTEND_PORT" > "$FE_LOG" 2>&1 &
    echo $! > /tmp/frontend-${E2E_FRONTEND_PORT}.pid
  )

  elapsed=0
  until curl -sf "http://localhost:${E2E_FRONTEND_PORT}/" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge "$E2E_HEALTH_TIMEOUT" ]; then
      echo "[harness-e2e-up] Frontend $E2E_FRONTEND_PORT NOT ready after ${E2E_HEALTH_TIMEOUT}s, log=$FE_LOG" >&2
      exit 5
    fi
  done
  echo "[harness-e2e-up] Frontend ready @ $E2E_FRONTEND_PORT"
fi

echo "[harness-e2e-up] all services ready (PG=$E2E_DB_PORT Brain=$E2E_BRAIN_PORT Frontend=$E2E_FRONTEND_PORT)"
exit 0
