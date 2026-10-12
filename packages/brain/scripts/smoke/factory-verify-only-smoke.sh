#!/usr/bin/env bash
# 真模块流程回归：依赖注入阻断 SSH/OpenClaw，不触生产 Brain 或设备。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
node ../../node_modules/vitest/vitest.mjs run scripts/factory-dispatcher/__tests__ --maxWorkers=1 --minWorkers=1
