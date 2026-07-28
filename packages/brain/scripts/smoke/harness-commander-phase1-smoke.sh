#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

(
  cd "$REPO_ROOT/packages/brain"
  npx vitest run \
    src/__tests__/migration-367-harness-commander-phase1.test.js \
    src/orchestrator/__tests__/commander-contract.test.js \
    src/orchestrator/__tests__/commander-store.test.js \
    src/orchestrator/__tests__/run-event-store.test.js \
    src/orchestrator/__tests__/actor-inbox.test.js \
    src/orchestrator/__tests__/commander-bundle.test.js \
    src/orchestrator/__tests__/directive-validator.test.js \
    src/routes/__tests__/harness-commander.test.js \
    src/__tests__/integration/harness-commander-phase1.integration.test.js \
    src/orchestrator/__tests__/attempt-store.test.js \
    src/orchestrator/__tests__/decision-log.test.js
)

echo "PASS: Harness Commander Phase 1 contracts and persistence"
