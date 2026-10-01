#!/usr/bin/env bash
# 真 PostgreSQL 验证加权竞争、取消占位、确认释放与恢复回滚；只创建隔离 schema。
set -euo pipefail

if ! DB_NAME="${DB_NAME:-cecelia_test}" node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}" "${TEST_DATABASE_URL:---db-env}"; then
  [[ "${SMOKE_ALLOW_WRITE:-}" != '1' ]] && exit 0
  exit 1
fi

export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_test}" TEST_DATABASE_URL="${TEST_DATABASE_URL:-}"
export DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}"
case "$DB_NAME" in
  *_scratch|*_test) ;;
  *) echo '拒绝连接：smoke 只允许 scratch/test 数据库' >&2; exit 1 ;;
esac

# TEST_DATABASE_URL 在测试中优先于 DB_NAME，必须同样验证，且不打印连接串。
node --input-type=module <<'NODE'
if (process.env.TEST_DATABASE_URL) {
  try {
    const uri = new URL(process.env.TEST_DATABASE_URL);
    const name = decodeURIComponent(uri.pathname.slice(1));
    if (!/_(scratch|test)$/.test(name)) throw new Error('unsafe database');
    // node-pg uses PGPORT only when the actual URI omits its port.
    if (!uri.port && process.env.PGPORT && process.env.PGPORT !== '5432') throw new Error('effective port override');
  } catch {
    console.error('拒绝连接：TEST_DATABASE_URL 必须指向 scratch/test 数据库');
    process.exit(1);
  }
}
NODE

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec node "$(node -p 'require.resolve("vitest/vitest.mjs")')" run \
  --config vitest.integration.config.js \
  src/__tests__/integration/attempt-weighted-reservation.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
