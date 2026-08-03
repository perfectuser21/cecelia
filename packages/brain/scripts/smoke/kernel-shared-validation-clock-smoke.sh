#!/usr/bin/env bash
# Kernel validation roles must share one Controller-owned timeout window.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"

cd "$ROOT_DIR/packages/brain"
npx --no-install vitest run \
  src/orchestrator/__tests__/validation-clock.test.js \
  src/orchestrator/__tests__/loop.test.js \
  src/orchestrator/__tests__/dispatcher.test.js \
  scripts/fleet-worker/attempt-runner.test.cjs \
  --reporter=dot

echo "KERNEL_SHARED_VALIDATION_CLOCK_SMOKE_PASS"
