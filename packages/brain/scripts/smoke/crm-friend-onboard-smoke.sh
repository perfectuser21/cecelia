#!/usr/bin/env bash
# 仅显式允许的测试库与独立schema；Notion为内存协议，不发送真实请求。
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$TASK_ROOT/packages/brain"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/crm-friend-onboard.pg.integration.test.js \
  src/__tests__/integration/crm-onboard-projection.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
