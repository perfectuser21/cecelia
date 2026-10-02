#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_scratch}"
export DB_USER="${DB_USER:-${USER}}"
npx vitest run --config vitest.integration.config.js src/app-server/__tests__/integration/store.test.js src/app-server/__tests__/integration/authorization-store.test.js src/app-server/__tests__/integration/canary-reservation.test.js scripts/fleet-worker/app-server-http.test.js --maxWorkers=1 --minWorkers=1
