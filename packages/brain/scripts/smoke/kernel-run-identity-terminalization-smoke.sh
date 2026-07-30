#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"

expected_schema="$(
  sed -n "s/.*EXPECTED_SCHEMA_VERSION = '\\([0-9]*\\)'.*/\\1/p" \
    src/selfcheck.js \
    | head -1
)"
test "$expected_schema" -ge "375"

npx --no-install vitest run \
  src/__tests__/migration-375-kernel-run-identity.test.js \
  src/__tests__/integration/migration-375-kernel-run-identity.integration.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js \
  src/lib/__tests__/harness-orphan-guard.test.js \
  src/__tests__/kernel-run-identity-preflight.test.js \
  --reporter=dot

report="$(node scripts/kernel-run-identity-preflight.mjs)"
node -e "
const report = JSON.parse(process.argv[1]);
if (!Array.isArray(report.duplicateActiveTasks)) process.exit(1);
if (!Array.isArray(report.historicalUntrustedRunIds)) process.exit(1);
" "$report"

echo "KERNEL_RUN_IDENTITY_TERMINALIZATION_SMOKE_PASS"
