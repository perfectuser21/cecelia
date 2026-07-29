#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

(
  cd "$REPO_ROOT/packages/brain"
  npx vitest run \
    src/__tests__/migration-370-gp-governance-decisions.test.js \
    src/__tests__/harness-line-context.test.js \
    src/__tests__/selfcheck.test.js \
    src/__tests__/learnings-vectorize.test.js \
    --pool=forks \
    --maxWorkers=1
)

(
  cd "$REPO_ROOT"
  node scripts/facts-check.mjs
)

echo "PASS: finalized GP governance decisions are idempotent, inherited, and startup-required"
