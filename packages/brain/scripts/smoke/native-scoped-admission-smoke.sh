#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
case "${DB_NAME:-cecelia_scratch}" in
 cecelia_scratch) ;;
 cecelia_test) [[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true ]] || exit 2 ;;
 *) echo "isolated test database required" >&2; exit 2 ;;
esac
cd "$ROOT/packages/brain"
node ../../node_modules/vitest/vitest.mjs run src/lib/__tests__/implementation-pr-gate.test.js src/lib/__tests__/implementation-ci-workflow.test.js --maxWorkers=1 --minWorkers=1
DB_NAME="${DB_NAME:-cecelia_scratch}" DB_USER="${DB_USER:-administrator}" DB_HOST="${DB_HOST:-/tmp}" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/implementation-admission-companion.test.js src/__tests__/integration/implementation-multi-scope.test.js --maxWorkers=1 --minWorkers=1
