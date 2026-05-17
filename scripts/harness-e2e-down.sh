#!/usr/bin/env bash
# Harness v2 M5 — Final E2E 环境清理脚本
#
# 对称 scripts/harness-e2e-up.sh：
#   - docker compose down（带 -v 清 PG 数据卷）
#   - pkill 对应端口的 Brain / Frontend 进程
#
# PRD: docs/design/harness-v2-prd.md §5.7 · §6.4
#
# 永远 exit 0（清理失败不能阻塞后续流程；失败信息写 stderr）。

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

E2E_COMPOSE="${E2E_COMPOSE:-docker-compose.e2e.yml}"
E2E_BRAIN_PORT="${E2E_BRAIN_PORT:-5222}"
E2E_FRONTEND_PORT="${E2E_FRONTEND_PORT:-5174}"

echo "[harness-e2e-down] tearing down staging env"

# 1. 停 Brain
BRAIN_PIDFILE="/tmp/brain-${E2E_BRAIN_PORT}.pid"
if [ -f "$BRAIN_PIDFILE" ]; then
  pid="$(cat "$BRAIN_PIDFILE")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "[harness-e2e-down] killed Brain pid=$pid"
  fi
  rm -f "$BRAIN_PIDFILE"
fi
pkill -f "BRAIN_PORT=${E2E_BRAIN_PORT}" 2>/dev/null || true
pkill -f "PORT=${E2E_BRAIN_PORT} .*server.js" 2>/dev/null || true

# 2. 停 Frontend
FE_PIDFILE="/tmp/frontend-${E2E_FRONTEND_PORT}.pid"
if [ -f "$FE_PIDFILE" ]; then
  pid="$(cat "$FE_PIDFILE")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "[harness-e2e-down] killed Frontend pid=$pid"
  fi
  rm -f "$FE_PIDFILE"
fi
pkill -f "port ${E2E_FRONTEND_PORT}" 2>/dev/null || true
pkill -f "vite.*${E2E_FRONTEND_PORT}" 2>/dev/null || true

# 3. 停 Postgres（docker compose down -v 清数据卷）
if [ -f "$E2E_COMPOSE" ]; then
  docker compose -f "$E2E_COMPOSE" down -v 2>&1 | sed 's/^/[harness-e2e-down] /' || true
else
  echo "[harness-e2e-down] compose file not found: $E2E_COMPOSE" >&2
fi

echo "[harness-e2e-down] done"
exit 0
