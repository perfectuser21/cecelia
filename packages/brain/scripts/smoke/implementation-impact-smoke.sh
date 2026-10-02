#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '实现影响smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run \
  src/lib/__tests__/map-brain-bindings.test.js \
  src/lib/__tests__/implementation-consumers-input.test.js \
  src/lib/__tests__/implementation-impact.test.js \
  src/lib/__tests__/implementation-ci-gate.test.js \
  --maxWorkers=1 --minWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/map-brain-bindings.pg.integration.test.js \
  src/__tests__/integration/implementation-consumers.pg.integration.test.js \
  src/__tests__/integration/implementation-impact.pg.integration.test.js \
  src/__tests__/integration/implementation-impact-ci.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
