#!/usr/bin/env bash
set -euo pipefail
# Runs正式注册：真实隔离PG迁移/唯一索引/事务；不连Notion、不写生产。
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo 'Runs smoke仅允许scratch或CI测试库' >&2
  exit 1
fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
 src/__tests__/integration/task-runs-projection.pg.integration.test.js --maxWorkers=1 --minWorkers=1
