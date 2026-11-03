#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
node --test "$ROOT/packages/brain/scripts/smoke/__tests__/smoke-production-guard.node-test.mjs" "$ROOT/packages/brain/scripts/smoke/__tests__/smoke-isolated-health.node-test.mjs" "$ROOT/packages/brain/scripts/smoke/__tests__/smoke-sql-entries.node-test.mjs" "$ROOT/packages/brain/scripts/smoke/__tests__/smoke-delegate-targets.node-test.mjs" "$ROOT/packages/brain/scripts/smoke/__tests__/phone-dispatch-smoke-env.node-test.mjs"
