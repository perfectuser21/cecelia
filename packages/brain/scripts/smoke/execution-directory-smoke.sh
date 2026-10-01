#!/usr/bin/env bash
set -euo pipefail
BRAIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$BRAIN_ROOT"
test -f config/fleet-node-profiles.json
test -f src/execution-directory/directory.js
node ../../node_modules/vitest/vitest.mjs run src/execution-directory/directory.test.js src/execution-directory/directory-consumers.test.js --maxWorkers=1 --minWorkers=1
