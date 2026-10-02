#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
export NODE_ENV=test
npx vitest run tests/gp/f1/step3-linux-observation-no-grant.test.js --maxWorkers=1 --minWorkers=1
