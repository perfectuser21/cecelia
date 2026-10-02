#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '发布证据smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/lib/__tests__/span-provenance.test.js \
  src/lib/__tests__/run-reconciliation.test.js \
  src/lib/__tests__/task-run.test.js \
  src/lib/__tests__/integration/release-index.test.js \
  src/lib/__tests__/integration/run-definition-binding.test.js \
  src/lib/__tests__/integration/task-run-definition.test.js \
  src/routes/__tests__/integration/releases.test.js \
  src/routes/__tests__/integration/run-definitions.test.js \
  src/routes/__tests__/integration/run-reconciliation.test.js \
  src/__tests__/integration/span-provenance.pg.integration.test.js \
  src/__tests__/integration/span-ingestion.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
