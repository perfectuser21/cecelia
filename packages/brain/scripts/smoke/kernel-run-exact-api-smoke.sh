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
test "$expected_schema" = "377"

npx --no-install vitest run \
  src/__tests__/migration-376-kernel-run-trust.test.js \
  src/__tests__/integration/migration-376-kernel-run-trust.integration.test.js \
  src/__tests__/migration-377-initiative-run-insert-lock.test.js \
  src/__tests__/integration/migration-377-initiative-run-insert-lock.integration.test.js \
  src/__tests__/relay-runs-exact-api.test.js \
  src/__tests__/integration/relay-run-exact-api.integration.test.js \
  src/__tests__/relay-runs-legacy-adapter.test.js \
  src/__tests__/kernel-run-trust-reconcile.test.js \
  src/__tests__/relay-runs-summary.test.js \
  src/__tests__/harness-watchdog.test.js \
  src/__tests__/harness-relay-watchdog.test.js \
  src/__tests__/harness-relay-watchdog-gates.test.js \
  src/__tests__/harness-relay-watchdog-exact-identity.test.js \
  src/orchestrator/__tests__/kernel-run-store.test.js \
  src/orchestrator/__tests__/run-trust-classifier.test.js \
  --reporter=dot

echo "KERNEL_RUN_EXACT_API_SMOKE_PASS"
