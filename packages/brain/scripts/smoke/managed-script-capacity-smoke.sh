#!/usr/bin/env bash
# 真 PostgreSQL 验证脚本共享预约、认证worker实际派发与收割、确认释放与崩溃恢复；只创建隔离 schema。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_test}"
case "$DB_NAME" in
  *_scratch|*_test) ;;
  *) echo '拒绝连接：smoke 只允许 scratch/test 数据库' >&2; exit 1 ;;
esac

# TEST_DATABASE_URL 在测试中优先于 DB_NAME，必须同样验证，且不打印连接串。
node --input-type=module <<'NODE'
if (process.env.TEST_DATABASE_URL) {
  try {
    const name = decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1));
    if (!/_(scratch|test)$/.test(name)) throw new Error('unsafe database');
  } catch {
    console.error('拒绝连接：TEST_DATABASE_URL 必须指向 scratch/test 数据库');
    process.exit(1);
  }
}
NODE

exec node "$(node -p 'require.resolve("vitest/vitest.mjs")')" run \
  --config vitest.integration.config.js \
  src/__tests__/integration/script-capacity-reservation.pg.integration.test.js \
  src/__tests__/integration/script-managed-executor.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
