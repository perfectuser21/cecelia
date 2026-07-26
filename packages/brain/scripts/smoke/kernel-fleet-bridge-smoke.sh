#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

bash "$ROOT/packages/brain/scripts/codex-bridge/install-kernel-bridge.test.sh"

cd "$ROOT/packages/brain"
npx vitest run \
  src/__tests__/codex-bridge-health.test.js \
  src/__tests__/codex-bridge-kernel-attempt.test.js \
  src/orchestrator/remote-bridge-transport.test.js \
  --silent

echo "PASS: Kernel Bridge installer, service routes, and transport contract"
