#!/usr/bin/env bash
# 退役验收：私有真实API/PG与dispatch入口，不驱动共享Brain的全局tick。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}" --db-env; then
  exit 1
fi

# 守卫已核容器和同一DB_*；防dotenv把未核TEST_DATABASE_URL重新灌回。
export TEST_DATABASE_URL=''
export NODE_ENV=test
if [[ "${CI:-}" == 'true' ]]; then
  expected_database=cecelia_test
else
  expected_database=cecelia_scratch
fi
if [[ "${DB_NAME:-}" != "$expected_database" ]]; then
  echo '退役smoke本地仅scratch，CI仅cecelia_test；拒绝未核数据库' >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# 真实Router POST/GET、路由收据、dispatchNextTask/finalizeTask/selector与终态查库。
# 资源/policy仅私有测试fixture，不代表生产物理容量或共享全局tick整轮已通过。
exec node "$(node -p 'require.resolve("vitest/vitest.mjs")')" run \
  --config vitest.integration.config.js \
  src/__tests__/integration/retired-harness-dispatch.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
