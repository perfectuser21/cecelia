#!/usr/bin/env bash
# 真实npm writer→强鉴权HTTP→删除/df复验→隔离PG tasks与路由收据。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
node --test scripts/preview-cache.test.mjs scripts/preview-cache-http.test.mjs
cd packages/brain
npx vitest run --config vitest.integration.config.js src/__tests__/integration/preview-cache.pg.integration.test.js --maxWorkers=1 --minWorkers=1
