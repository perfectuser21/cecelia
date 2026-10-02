#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '试点发布回归smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/lib/__tests__/pilot-release-verification.test.js \
  src/lib/__tests__/integration/pilot-release-verification.test.js \
  src/__tests__/integration/pilot-release-ci.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
