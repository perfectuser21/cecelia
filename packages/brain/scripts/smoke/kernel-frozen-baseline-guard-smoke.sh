#!/usr/bin/env bash
# Kernel frozen-baseline guard — end-to-end contract smoke.
# Covers the three enforcement layers that production run d9785137 lacked:
#   1) dispatcher/workspace/transport propagation of the frozen invariant,
#   2) the Runner push-time lineage guard,
#   3) the server-side fail-closed callback verification.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

(
  cd "$REPO_ROOT/packages/brain"
  npx vitest run \
    src/orchestrator/workspace-spec.test.js \
    src/orchestrator/commit-lineage-resolver.test.js \
    src/orchestrator/remote-bridge-transport.test.js \
    src/orchestrator/__tests__/harness-generator-frozen-baseline-skill.test.js \
    scripts/fleet-worker/workspace-manager.test.cjs \
    scripts/fleet-worker/attempt-runner.test.cjs \
    src/routes/__tests__/harness-attempt-callback.test.js
)

bash "$REPO_ROOT/docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh"

echo "kernel frozen baseline guard smoke passed"
