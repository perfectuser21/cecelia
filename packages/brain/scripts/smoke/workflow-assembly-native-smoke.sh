#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/workflow-assembly-native.pg.integration.test.js \
  src/__tests__/integration/native-maintenance-snapshot.pg.integration.test.js src/lib/native-maintenance-snapshot.test.js \
  src/lib/workflow-assembly-native.test.js src/lib/workflow-assembly-native-source.test.js \
  src/lib/workflow-assembly-native-registration.test.js src/lib/workflow-assembly-native-ledger.test.js \
  src/routes/workflow-assembly-native.test.js --maxWorkers=1 --minWorkers=1
