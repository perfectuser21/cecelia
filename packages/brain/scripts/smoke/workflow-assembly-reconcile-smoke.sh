#!/usr/bin/env bash
# 真实私有schema对账/去重/回滚，fixture拒绝生产和未授权测试库。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/workflow-assembly-reconcile.pg.integration.test.js \
  src/__tests__/integration/workflow-assembly-reconcile-authoring.pg.integration.test.js \
  src/lib/workflow-assembly-reconcile.test.js src/lib/workflow-assembly-reconcile-runner.test.js \
  src/lib/workflow-assembly-reconcile-derived.test.js src/lib/workflow-assembly-reconcile-tasks.test.js \
  --maxWorkers=1 --minWorkers=1
