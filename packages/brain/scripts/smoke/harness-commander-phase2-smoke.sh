#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

(
  cd "$REPO_ROOT/packages/brain"
  npx vitest run \
    src/__tests__/migration-368-harness-commander-phase2.test.js \
    src/__tests__/integration/harness-commander-phase2.integration.test.js \
    src/orchestrator/__tests__/commander-profile.test.js \
    src/orchestrator/__tests__/commander-wakeup.test.js \
    src/orchestrator/__tests__/commander-coordinator.test.js \
    src/orchestrator/__tests__/commander-directive-executor.test.js \
    src/orchestrator/__tests__/execution-contract.test.js \
    src/orchestrator/__tests__/directive-validator.test.js \
    src/orchestrator/__tests__/dispatcher.test.js \
    src/orchestrator/__tests__/loop.test.js \
    src/orchestrator/__tests__/run.test.js \
    src/orchestrator/providers/shared.test.js \
    src/orchestrator/providers/claude.test.js \
    src/orchestrator/providers/codex.test.js \
    src/orchestrator/providers/grok.test.js \
    src/routes/__tests__/harness-attempt-callback.test.js
)

(
  cd "$REPO_ROOT"
  bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
)

echo "PASS: Harness Commander Phase 2 transport, L0, failover, and PostgreSQL authority"
