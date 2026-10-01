#!/usr/bin/env bash
# 真实npm writer→强鉴权HTTP→删除/df复验→隔离PG tasks与路由收据。
set -euo pipefail

if ! DB_NAME="${DB_NAME:-cecelia_scratch}" DB_HOST="${DB_HOST:-/tmp}" DB_PORT="${DB_PORT:-5432}" node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}" --db-env; then
  [[ "${SMOKE_ALLOW_WRITE:-}" != '1' ]] && exit 0
  exit 1
fi
export DB_NAME="${DB_NAME:-cecelia_scratch}" DB_HOST="${DB_HOST:-/tmp}" DB_PORT="${DB_PORT:-5432}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
node --test scripts/preview-cache.test.mjs scripts/preview-cache-http.test.mjs
cd packages/brain
npx vitest run --config vitest.integration.config.js src/__tests__/integration/preview-cache.pg.integration.test.js --maxWorkers=1 --minWorkers=1
