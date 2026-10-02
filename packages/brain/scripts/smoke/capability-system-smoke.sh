#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '能力系统smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/lib/__tests__/integration/capability-regressions.test.js \
  src/routes/__tests__/integration/capability-regressions.test.js \
  src/lib/__tests__/integration/capability-system.test.js \
  src/lib/__tests__/integration/capability-system-evidence.test.js \
  src/lib/__tests__/capability-system-impact.test.js \
  src/routes/__tests__/integration/capability-system.test.js \
  src/lib/__tests__/integration/implementation-ci-snapshot.test.js \
  src/lib/__tests__/integration/implementation-ci-company.test.js \
  src/lib/__tests__/integration/implementation-ci-pilots.test.js \
  src/lib/__tests__/integration/implementation-ci-pilot-manifest.test.js \
  src/lib/__tests__/integration/capability-source-coverage.test.js \
  src/routes/__tests__/integration/capability-source-coverage.test.js \
  src/routes/__tests__/integration/implementation-ci.test.js \
  src/__tests__/integration/implementation-ci-cli.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
