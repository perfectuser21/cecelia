#!/usr/bin/env bash
set -euo pipefail
# 真实PostgreSQL隔离schema + Express HTTP；每个用例自动清理，禁止生产库。
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '共享活动smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/shared-activities.pg.integration.test.js \
  src/__tests__/integration/company-kr-registration.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
