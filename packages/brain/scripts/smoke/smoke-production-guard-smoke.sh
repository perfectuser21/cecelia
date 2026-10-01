#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
node --test "$ROOT/packages/quality/tests/smoke-production-guard.node-test.mjs"
