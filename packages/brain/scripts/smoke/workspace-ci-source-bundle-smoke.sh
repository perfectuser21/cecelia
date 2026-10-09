#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '跨仓来源 smoke 仅允许本地 scratch 或 CI 测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR/../.."
node --test scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run \
  src/lib/__tests__/consumer-source-set.test.js \
  src/lib/__tests__/workspace-ci-source-bundle.test.js \
  src/lib/__tests__/existing-ops-registration.test.js \
  --maxWorkers=1 --minWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/pilot-release-ci.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
