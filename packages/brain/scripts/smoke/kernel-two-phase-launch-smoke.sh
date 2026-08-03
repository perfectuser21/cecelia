#!/usr/bin/env bash
# Kernel Fleet two-phase launch smoke.
#
# This is deliberately bounded: it exercises the crash boundary and rollout
# protocol without starting a provider session or calling an external model.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"

cd "$ROOT_DIR/packages/brain"
npx --no-install vitest run \
  scripts/fleet-worker/attempt-runner.test.cjs \
  src/orchestrator/remote-bridge-transport.test.js \
  src/orchestrator/expired-attempt-reconciler.test.js \
  --reporter=dot

bash scripts/fleet-worker/fleet-rollout.test.sh
bash scripts/fleet-worker/fleet-nodectl.test.sh

echo "KERNEL_TWO_PHASE_LAUNCH_SMOKE_PASS"
