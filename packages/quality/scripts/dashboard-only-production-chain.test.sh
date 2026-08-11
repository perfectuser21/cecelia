#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR"

npx vitest run \
  sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts \
  tests/regression/dashboard-only-staging-contract.test.ts \
  --reporter=verbose
