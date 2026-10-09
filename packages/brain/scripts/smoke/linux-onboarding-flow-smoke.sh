#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
npx vitest run src/linux-pool/onboarding-flow.test.js src/linux-pool/onboarding-upgrade.test.js scripts/fleet-worker/linux-pool-installer.test.cjs scripts/fleet-worker/linux-pool-bootstrap.test.js scripts/fleet-worker/linux-onboarding-remote.test.js src/linux-pool/onboarding-projection.test.js src/linux-pool/onboarding-recovery.test.js src/node-onboarding/execution-view.test.js src/linux-pool/onboarding-artifact.test.js src/linux-pool/onboarding-step.test.js src/linux-pool/cleanup-receipt.test.js --maxWorkers=1 --minWorkers=1
npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-onboarding-flow.pg.integration.test.js src/linux-pool/__tests__/integration/active-grants.test.js src/linux-pool/__tests__/integration/onboarding-revocation.test.js --maxWorkers=1 --minWorkers=1
