#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
export NODE_ENV=test
npx vitest run tests/gp/f1/step3-app-server-generation.test.js --maxWorkers=1 --minWorkers=1
