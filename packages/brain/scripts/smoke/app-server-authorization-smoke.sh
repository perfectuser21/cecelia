#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_scratch}"
export DB_USER="${DB_USER:-${USER}}"
# 真实独立schema、HTTP、持久runner；Docker适配器由夹具隔离，不接生产宿主。
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/app-server/__tests__/integration/canary-service.test.js \
  src/app-server/__tests__/integration/canary-renewal.test.js \
  src/app-server/__tests__/integration/canary-evidence.test.js \
  --maxWorkers=1 --minWorkers=1
