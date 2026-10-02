#!/usr/bin/env bash
set -euo pipefail
# 不可变定义、上层登记及组织读取：真实HTTP→隔离PostgreSQL，每例自动清理。
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '定义版本smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/definition-versions.pg.integration.test.js \
  src/__tests__/integration/journey-registration.pg.integration.test.js \
  src/__tests__/integration/workflow-organization.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
