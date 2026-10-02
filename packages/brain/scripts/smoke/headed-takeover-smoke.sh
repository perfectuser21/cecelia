#!/usr/bin/env bash
# 有头接管验收：私有真实HTTP/PG、接管和提交后handoff，以及设备孤儿锁安全清扫。
set -euo pipefail
# 在守卫前固定其原缺省目标，禁止后续dotenv填入未核HOST/PORT。
export DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}"
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
  echo '有头接管smoke本地仅scratch，CI仅cecelia_test；拒绝未核数据库' >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# 原生HTTP Bearer/session/CAS接管与legacy PATCH、实际COMMIT后saveHandoff查库；
# 同时验证真实065/448/509设备锁迁移和ordinary删除→清扫，不接触生产执行体。
exec node "$(node -p 'require.resolve("vitest/vitest.mjs")')" run \
  --config vitest.integration.config.js \
  src/__tests__/integration/headed-takeover.pg.integration.test.js \
  src/__tests__/integration/device-lock-helpers.test.js \
  --maxWorkers=1 --minWorkers=1
