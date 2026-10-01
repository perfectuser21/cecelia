#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
npx vitest run scripts/fleet-worker/app-server-attach.test.js scripts/fleet-worker/app-server-rpc.test.js scripts/fleet-worker/app-server-rpc-flow.test.js scripts/fleet-worker/app-server-stream-http.test.js scripts/fleet-worker/app-server-shim.test.js scripts/fleet-worker/app-server-canary-policy.test.js scripts/fleet-worker/app-server-stream-hub.test.js --maxWorkers=1 --minWorkers=1
