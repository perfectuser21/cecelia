#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

(
  cd "$REPO_ROOT/packages/brain"
  npx vitest run \
    src/orchestrator/credential-broker.test.js \
    src/orchestrator/__tests__/run.test.js \
    src/orchestrator/remote-bridge-transport.test.js \
    src/orchestrator/production-transport.test.js \
    scripts/fleet-worker/credential-envelope.test.cjs \
    scripts/fleet-worker/attempt-runner.test.cjs \
    scripts/fleet-worker/fleet-worker.test.js \
    src/routes/__tests__/harness-attempt-callback.test.js
)

bash "$REPO_ROOT/docker/cecelia-runner/__tests__/entrypoint-codex-credential-envelope.test.sh"

echo "fleet CredentialEnvelope contract smoke passed"
