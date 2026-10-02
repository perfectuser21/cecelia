#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
npx vitest run src/linux-pool/runtime-service.test.js src/linux-pool/runtime-deployment.test.js src/linux-pool/runtime-receipt.test.js src/linux-pool/runtime-admission.test.js scripts/fleet-worker/linux-script-permit.test.cjs scripts/fleet-worker/linux-script-runtime.test.cjs --maxWorkers=1 --minWorkers=1
npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-script-authorization.pg.integration.test.js --maxWorkers=1 --minWorkers=1
