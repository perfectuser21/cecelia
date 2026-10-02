#!/usr/bin/env bash
# 真实Postgres临时表验证配置/事件一起提交和失败回滚，不修改生产配置。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT/packages/brain"
export DB_NAME="${DB_NAME:-${PGDATABASE:-cecelia_scratch}}"
export DB_HOST="${DB_HOST:-${PGHOST:-localhost}}"
export DB_PORT="${DB_PORT:-${PGPORT:-5432}}"
export DB_USER="${DB_USER:-${PGUSER:-${USER:-cecelia}}}"
export DB_PASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"
npx vitest run --config vitest.integration.config.js src/__tests__/integration/agent-model-change.pg.integration.test.js --maxWorkers=1 --minWorkers=1
