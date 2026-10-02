#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run \
  src/phone-dispatch/client.test.js \
  src/phone-dispatch/identity.test.js \
  src/phone-dispatch/contracts.test.js \
  src/phone-dispatch/task-ownership.test.js \
  scripts/phone-ssh/runner.test.js \
  --maxWorkers=1 --minWorkers=1
