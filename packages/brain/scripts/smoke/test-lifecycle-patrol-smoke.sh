#!/usr/bin/env bash
# smoke: test-lifecycle-patrol — test_registry 生命周期巡检真环境验证
# 验证 migration 311 已在真实 Postgres 生效 + runTestLifecyclePatrol 能对真实 schema 跑通
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "── test-lifecycle-patrol smoke ──"

echo "1. 验证 test-lifecycle-patrol.js 导出正确"
node -e "
const c = require('fs').readFileSync('packages/brain/src/test-lifecycle-patrol.js', 'utf8');
if (!c.includes('export async function runTestLifecyclePatrol')) { console.error('FAIL: 缺少 runTestLifecyclePatrol 导出'); process.exit(1); }
if (!c.includes('export function isInPatrolWindow')) { console.error('FAIL: 缺少 isInPatrolWindow 导出'); process.exit(1); }
console.log('  ✅ 导出验证通过');
"

echo "2. 验证 tick-runner.js 已接入 10.24 巡检挂载"
node -e "
const c = require('fs').readFileSync('packages/brain/src/tick-runner.js', 'utf8');
if (!c.includes('test-lifecycle-patrol.js')) { console.error('FAIL: tick-runner.js 未 import test-lifecycle-patrol'); process.exit(1); }
if (!c.includes('runTestLifecyclePatrol(pool)')) { console.error('FAIL: tick-runner.js 未调用 runTestLifecyclePatrol'); process.exit(1); }
console.log('  ✅ tick-runner 接入验证通过');
"

echo "3. 验证 migration 311 已在真实 Postgres 生效（4 新列 + test_lifecycle_alerts 表）"
cd packages/brain
node --input-type=module -e "
import pool from './src/db.js';
const cols = await pool.query(\`SELECT column_name FROM information_schema.columns
  WHERE table_name='test_registry' AND column_name IN ('status','feature_id','orphan_reason','lifecycle_checked_at')\`);
if (cols.rows.length !== 4) { console.error('FAIL: test_registry 缺少生命周期列，实际:', cols.rows); process.exit(1); }
const t = await pool.query(\`SELECT to_regclass('test_lifecycle_alerts') as exists\`);
if (!t.rows[0].exists) { console.error('FAIL: test_lifecycle_alerts 表不存在'); process.exit(1); }
console.log('  ✅ migration 311 schema 验证通过');
await pool.end();
"

echo "4. 真实调用 runTestLifecyclePatrol，验证 SQL 对真实 schema 跑通不报错（proven-to-fire，事务内跑完 ROLLBACK，不改动真实数据）"
# 用单个 Client（非 Pool）开事务，把 runTestLifecyclePatrol 传入的 db 参数换成这个事务内连接，
# 跑完无论成功与否都 ROLLBACK——这样能验证 SQL 对真实 schema 是否兼容（proven-to-fire），
# 又不会像 Pool 那样直接提交，误删/误改真实环境里 test_registry 的真实数据（本地曾因此误删过50行）。
node --input-type=module -e "
import pg from 'pg';
import { runTestLifecyclePatrol } from './src/test-lifecycle-patrol.js';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('BEGIN');
try {
  const result = await runTestLifecyclePatrol(client);
  if (!Array.isArray(result.staleAlerts)) { throw new Error('返回值缺少 staleAlerts 数组'); }
  console.log('  ✅ runTestLifecyclePatrol 对真实 DB schema 跑通（事务已 ROLLBACK，未改动真实数据），staleAlerts=' + result.staleAlerts.length);
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
"

echo "✅ test-lifecycle-patrol smoke 全部通过"
