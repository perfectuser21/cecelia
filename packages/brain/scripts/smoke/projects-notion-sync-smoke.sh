#!/usr/bin/env bash
# 项目同步回归：真实 helper/Express 路由 + 隔离 PostgreSQL schema，禁连生产库。
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "${CI:-}" == true ]]; then
  export DB_NAME="${DB_NAME:-cecelia_test}"
  if [[ "$DB_NAME" != cecelia_test && "$DB_NAME" != cecelia_scratch ]]; then
    echo '项目同步 smoke 的 CI 数据库仅允许 cecelia_test 或 cecelia_scratch' >&2
    exit 1
  fi
  export DB_HOST="${DB_HOST:-localhost}"
else
  if [[ -n "${DB_NAME:-}" && "$DB_NAME" != cecelia_scratch ]]; then
    echo '项目同步 smoke 本地数据库仅允许 cecelia_scratch' >&2
    exit 1
  fi
  export DB_NAME=cecelia_scratch
  export DB_HOST="${DB_HOST:-/tmp}"
  export DB_USER="${DB_USER:-$(id -un)}"
fi
case "$DB_HOST" in
  localhost|127.0.0.1|::1|/tmp|/var/run/postgresql) ;;
  *) echo '项目同步 smoke 仅允许本机或 CI 本地 PostgreSQL' >&2; exit 1 ;;
esac
export NODE_ENV=test
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run \
  src/lib/__tests__/project-notion-human.test.js \
  src/__tests__/project-notion-ingest.test.js \
  src/__tests__/notion-relay-projection.projects.test.js \
  src/routes/__tests__/task-projects-ai-tier.test.js \
  --maxWorkers=1 --minWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/migration-554-projects-ai-tier.pg.integration.test.js \
  src/__tests__/integration/projects-notion-sync.pg.integration.test.js \
  src/__tests__/integration/relay-mirror-smoke.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
