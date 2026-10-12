#!/usr/bin/env bash
# 固定开关 API：真实 HTTP 入口 + 隔离 PG 启用/拒绝/回滚，并验证 F1 领单跨 watchdog。
# 只建私有 schema，fixture 结束 DROP；不访问生产 Brain、不操作手机。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
case "${DB_NAME:-cecelia_scratch}" in
  cecelia_scratch) ;;
  cecelia_test) [[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true ]] || exit 2 ;;
  *) echo "isolated test database required" >&2; exit 2 ;;
esac
cd "$REPO_ROOT/packages/brain"
node ../../node_modules/vitest/vitest.mjs run src/lib/__tests__/factory-commander-route.test.js --maxWorkers=1 --minWorkers=1
DB_NAME="${DB_NAME:-cecelia_scratch}" DB_USER="${DB_USER:-administrator}" DB_HOST="${DB_HOST:-/tmp}" \
  node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/factory-commander-route.pg.integration.test.js \
  ../../tests/gp/f1/step1-headed-lease.test.js --maxWorkers=1 --minWorkers=1
