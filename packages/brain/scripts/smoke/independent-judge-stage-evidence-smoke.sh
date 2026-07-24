#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BRAIN_DIR"

npx --no-install vitest run \
  src/orchestrator/__tests__/judge-default-assembly.integration.test.js \
  src/__tests__/harness-judge.test.js \
  --reporter=dot
