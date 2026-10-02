#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
node ../../node_modules/vitest/vitest.mjs run scripts/fleet-worker/gpu-observation.test.js \
  src/routes/__tests__/infra-status-gpu.test.js src/lib/__tests__/script-task-spec.test.js \
  --maxWorkers=1 --minWorkers=1
