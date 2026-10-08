#!/usr/bin/env bash
set -euo pipefail
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_DIR"
# 直接执行正式 loader、store 和 sync；仅使用文件契约 fixture，不连接数据库或设备。
node ../../node_modules/vitest/vitest.mjs run \
  src/lib/__tests__/activity-contract-loader.test.js \
  src/lib/__tests__/activity-contract-store.test.js \
  src/__tests__/activity-contract-sync.test.js \
  --maxWorkers=1 --minWorkers=1
