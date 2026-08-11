#!/usr/bin/env bash
# Verified existing-PR adoption must start one bounded Evaluator/Judge clock.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"

cd "$ROOT_DIR/packages/brain"
npx --no-install vitest run \
  src/orchestrator/__tests__/validation-clock.test.js \
  src/orchestrator/__tests__/loop.test.js \
  --reporter=dot

echo "KERNEL_EXISTING_PR_VALIDATION_CLOCK_SMOKE_PASS"
