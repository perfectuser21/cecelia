#!/usr/bin/env bash
# device-locks-smoke.sh — 手机/设备资源锁核心逻辑烟雾测试
#
# 真 node 进程 import device-lock-helpers.js（不连数据库，注入 mock pool），
# 验证抢锁/释放/对账 sweep 的核心行为不变量：
#  1) acquire：UPDATE 返回行 → result=acquired（第一条 SQL 必须是原子 UPDATE）
#  2) acquire：UPDATE 0 行 + 补查 SELECT 0 行 → unknown_device
#  3) acquire：UPDATE 0 行 + 补查有行 → locked（holder 透传）
#  4) ttl clamp：999→240、0→1、非数值→30（区间 [1,240]，非有限值回默认 30）
#  5) sweep SQL 含 uuid 正则守卫（非 uuid 手工持有者不被对账误扫）
#  6) release rowCount 透传
#
# 用法：bash packages/brain/scripts/smoke/device-locks-smoke.sh
# CI：由 packages/quality/smoke-allowlist.txt 注册后，ci-smoke-glob-runner.yml 自动调用
#
# 退出码：0 = 全部通过，非 0 = 某项失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "🔒 device-locks-smoke：验证设备锁核心逻辑（mock pool，真 node 进程）"
echo "  repo: $REPO_ROOT"
echo ""

if ! HELPERS="$REPO_ROOT/packages/brain/src/device-lock-helpers.js" \
  node --input-type=module <<'NODE_EOF'
const helpers = await import(process.env.HELPERS);
const { acquireDeviceLock, releaseDeviceLocksHeldBy, sweepStaleDeviceLocks } = helpers;

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS ${name}`);
    pass += 1;
  } else {
    console.error(`  ❌ FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    fail += 1;
  }
}

function makePool(responses) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      const next = responses.shift() || { rows: [], rowCount: 0 };
      return Promise.resolve(next);
    },
  };
}

// 1) acquire：mock 返回行 → acquired，且第一条 SQL 是原子 UPDATE ... RETURNING
{
  const lockRow = { device_name: 'PHONE-A', locked_by: 'task-1' };
  const pool = makePool([{ rows: [lockRow], rowCount: 1 }]);
  const r = await acquireDeviceLock('task-1', 'PHONE-A', 30, pool);
  check('acquire 返回行 → acquired', r.result === 'acquired' && r.lock === lockRow,
    `got ${JSON.stringify(r)}`);
  const firstSql = pool.calls[0].sql.trim();
  check('acquire 第一条 SQL 是 UPDATE ... RETURNING（原子抢锁）',
    /^UPDATE\s+device_locks/i.test(firstSql) && /RETURNING/i.test(firstSql),
    firstSql.slice(0, 60));
}

// 2) acquire：UPDATE 0 行 + 补查 0 行 → unknown_device
{
  const pool = makePool([
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: 0 },
  ]);
  const r = await acquireDeviceLock('task-1', 'GHOST-DEVICE', 30, pool);
  check('acquire 0行+补查0行 → unknown_device', r.result === 'unknown_device',
    `got ${JSON.stringify(r)}`);
  check('unknown_device 走了二次补查 SELECT',
    pool.calls.length === 2 && /^SELECT/i.test(pool.calls[1].sql.trim()),
    `calls=${pool.calls.length}`);
}

// 3) acquire：UPDATE 0 行 + 补查有行 → locked（holder 透传）
{
  const holder = { device_name: 'PHONE-A', locked_by: 'other-task' };
  const pool = makePool([
    { rows: [], rowCount: 0 },
    { rows: [holder], rowCount: 1 },
  ]);
  const r = await acquireDeviceLock('task-1', 'PHONE-A', 30, pool);
  check('acquire 0行+补查有行 → locked 且 holder 透传',
    r.result === 'locked' && r.holder === holder,
    `got ${JSON.stringify(r)}`);
}

// 4) ttl clamp：999→240、0→1、非数值→30（SQL 参数位 $2）
{
  const cases = [
    [999, '240'],
    [0, '1'],
    ['abc', '30'],
  ];
  for (const [input, expected] of cases) {
    const pool = makePool([{ rows: [{}], rowCount: 1 }]);
    await acquireDeviceLock('task-1', 'PHONE-A', input, pool);
    const got = pool.calls[0].params[1];
    check(`ttl clamp ${JSON.stringify(input)} → ${expected}`, got === expected, `got ${got}`);
  }
}

// 5) sweep SQL 含 uuid 正则守卫 + rowCount 透传
{
  const pool = makePool([{ rows: [], rowCount: 3 }]);
  const n = await sweepStaleDeviceLocks(pool);
  const sql = pool.calls[0].sql;
  check('sweep SQL 含 uuid 正则守卫',
    sql.includes("'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"),
    sql.slice(0, 80));
  check('sweep 只扫非活跃持有者（NOT EXISTS queued/in_progress）',
    /NOT EXISTS/i.test(sql) && sql.includes("'queued'") && sql.includes("'in_progress'"));
  check('sweep rowCount 透传', n === 3, `got ${n}`);
}

// 6) release rowCount 透传
{
  const pool = makePool([{ rows: [], rowCount: 2 }]);
  const n = await releaseDeviceLocksHeldBy('task-1', pool);
  check('release rowCount 透传', n === 2, `got ${n}`);
}

console.log('');
console.log(`通过: ${pass}  失败: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
NODE_EOF
then
  echo "❌ device-locks-smoke 失败"
  exit 1
fi
echo "✅ device-locks-smoke 全部通过"
exit 0
