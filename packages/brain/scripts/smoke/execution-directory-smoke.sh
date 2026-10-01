#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node ../../node_modules/vitest/vitest.mjs run src/execution-directory/directory.test.js src/execution-directory/directory-consumers.test.js --maxWorkers=1 --minWorkers=1
