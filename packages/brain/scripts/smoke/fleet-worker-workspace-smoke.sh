#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/packages/brain"

# Phase 4B contract evidence only. This intentionally uses temporary Git
# repositories and a recorded Docker boundary; it is not a real-task canary and
# must never be reported as Phase 5 business acceptance.
npx vitest run \
  src/orchestrator/workspace-spec.test.js \
  src/orchestrator/__tests__/execution-contract.test.js \
  scripts/fleet-worker/workspace-manager.test.cjs \
  scripts/fleet-worker/attempt-runner.test.cjs \
  scripts/fleet-worker/fleet-worker.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/orchestrator/providers/grok.test.js \
  src/orchestrator/production-transport.test.js \
  src/orchestrator/remote-bridge-transport.test.js

echo "PASS: Fleet Worker WorkspaceSpec and ownership contract regression"
