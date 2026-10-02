#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run \
  scripts/phone-hub/capabilities.test.js \
  scripts/phone-hub/runtime.test.js \
  scripts/phone-hub/execution.test.js \
  scripts/phone-hub/journal.test.js \
  scripts/phone-hub/maintenance.test.js \
  scripts/phone-ssh/runner.test.js \
  --maxWorkers=1 --minWorkers=1
