#!/usr/bin/env bash
# 事务装配探针：真实私有schema写入及回滚；fixture自身拒绝生产库与本地远端连接。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/workflow-assembly.pg.integration.test.js --maxWorkers=1 --minWorkers=1
