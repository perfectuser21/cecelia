#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
node --test "$ROOT/packages/quality/tests/smoke-production-guard.node-test.mjs" "$ROOT/packages/quality/tests/smoke-isolated-health.node-test.mjs" "$ROOT/packages/quality/tests/smoke-sql-entries.node-test.mjs" "$ROOT/packages/quality/tests/smoke-delegate-targets.node-test.mjs"
