#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
# 真shim子进程与本机HTTP接收器，不访问生产Brain或凭据。
node ../../node_modules/vitest/vitest.mjs run \
  scripts/fleet-worker/app-server-shim.test.js \
  scripts/fleet-worker/app-server-shim-home-map.test.js \
  --maxWorkers=1 --minWorkers=1
