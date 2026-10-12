#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
NODE_ENV=test npx vitest run src/__tests__/claude-launch-provenance-api.test.js --maxWorkers=1 --minWorkers=1
