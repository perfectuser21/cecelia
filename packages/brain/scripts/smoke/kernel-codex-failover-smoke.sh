#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_scratch}"
export DB_USER="${DB_USER:-${USER}}"
# 独立scratch/CI schema中的真并发预约；Fleet进程边界由夹具隔离，不启动生产Worker。
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/kernel-capacity-reselection.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
