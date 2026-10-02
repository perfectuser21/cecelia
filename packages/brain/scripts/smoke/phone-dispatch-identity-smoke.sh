#!/usr/bin/env bash
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}" --db-env; then
  exit 1
fi

# guard 已核对 Brain 容器及同一 DB_* 目标；空值锁定使dotenv不能重新灌入连接串。
export TEST_DATABASE_URL=''
export NODE_ENV=test
export DB_NAME="${DB_NAME:?已核对的 DB_NAME 必须显式提供}"
export DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}"
case "$DB_NAME" in
  cecelia_scratch|cecelia_test) ;;
  *) echo '拒绝连接：手机身份 smoke 只允许已核对的 scratch/test 数据库' >&2; exit 1 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# 真实 PG 行为在测试独立 schema 中验证；fixture grant 随 schema 清理。
exec node "$(node -p 'require.resolve("vitest/vitest.mjs")')" run \
  --config vitest.integration.config.js \
  src/phone-dispatch/store.test.js \
  src/phone-dispatch/identity.test.js \
  src/phone-dispatch/contracts.test.js \
  --maxWorkers=1 --minWorkers=1
