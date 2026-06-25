#!/usr/bin/env bash
# staging-e2e-smoke.sh — 阶段2 Slice1 真环境冒烟
#
# 验证 staging_e2e 闭环的真实可用性（不 mock）：
#   1. staging_e2e_results 表存在且 verdict CHECK 只接受 PASS/FAIL/SKIP（migration 304）
#   2. staging_e2e task_type 已进 tasks CHECK 约束（INSERT 不被拒）
#   3. createStagingE2eTask 真写一行 queued 任务 + dedup 生效
#   4. staging-e2e-plugin 真 claim 该任务并标 completed（handler 用 SKIP 短路，不真部署）
#   5. verdict 真落 staging_e2e_results
#
# 用真实 DB（cecelia / DB_NAME 可覆盖），跑完清理自己造的数据。
# 退出码：0 = 通过，非 0 = 失败。

set -uo pipefail
cd "$(dirname "$0")/../.."   # → packages/brain

export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_USER="${DB_USER:-cecelia}"
export DB_NAME="${DB_NAME:-cecelia}"

node --input-type=module <<'NODE'
import pg from 'pg';
import {
  createStagingE2eTask,
  handleStagingE2e,
} from '../../src/harness-staging-e2e.js';
import { tick } from '../../src/staging-e2e-plugin.js';

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USER, database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD || undefined,
  connectionTimeoutMillis: 5000,
});

const INIT = 'eeeeeeee-0000-4000-8000-00000000e2e0';
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) failed = true; };

try {
  // 0. 清理上次残留
  await pool.query(`DELETE FROM staging_e2e_results WHERE initiative_id = $1::uuid`, [INIT]).catch(() => {});
  await pool.query(`DELETE FROM tasks WHERE task_type='staging_e2e' AND payload->>'initiative_id' = $1`, [INIT]).catch(() => {});

  // 1. 表 + 约束存在性（INSERT 非法 verdict 应被拒）
  let constraintOk = false;
  try {
    await pool.query(
      `INSERT INTO staging_e2e_results (initiative_id, verdict) VALUES ($1::uuid, 'BOGUS')`, [INIT]);
  } catch (e) { constraintOk = /verdict/.test(e.message) || /check/i.test(e.message); }
  check(constraintOk, 'staging_e2e_results.verdict CHECK 拒绝非法值');

  // 2+3. createStagingE2eTask 真写 + dedup
  const r1 = await createStagingE2eTask(pool, { initiativeId: INIT, prUrl: 'smoke://pr' });
  check(r1.created === true && !!r1.taskId, `staging_e2e 任务创建成功（task_type 进约束）id=${r1.taskId}`);
  const r2 = await createStagingE2eTask(pool, { initiativeId: INIT });
  check(r2.created === false, 'dedup 生效：同 initiative 不重复建任务');

  // 4. plugin 真 claim 并执行（无合同 → handler SKIP 短路，不真部署）→ 标 completed
  const res = await tick({ pool, tickState: { lastStagingE2eTime: 0 }, intervalMs: 0 });
  check(res.ran === true && res.taskId === r1.taskId, `plugin claim 并执行任务，verdict=${res.verdict}`);
  const { rows: trows } = await pool.query(`SELECT status FROM tasks WHERE id=$1`, [r1.taskId]);
  check(trows[0]?.status === 'completed', '任务被标 completed');

  // 5. verdict 真落库（无合同 → SKIP/no_contract）
  const { rows: vrows } = await pool.query(
    `SELECT verdict, reason FROM staging_e2e_results WHERE initiative_id=$1::uuid ORDER BY created_at DESC LIMIT 1`, [INIT]);
  check(vrows[0]?.verdict === 'SKIP' && vrows[0]?.reason === 'no_contract', `verdict 落库 = ${vrows[0]?.verdict}/${vrows[0]?.reason}`);

  // 清理
  await pool.query(`DELETE FROM staging_e2e_results WHERE initiative_id = $1::uuid`, [INIT]);
  await pool.query(`DELETE FROM tasks WHERE task_type='staging_e2e' AND payload->>'initiative_id' = $1`, [INIT]);
} catch (e) {
  console.error('❌ smoke 异常:', e.message);
  failed = true;
} finally {
  await pool.end();
}
process.exit(failed ? 1 : 0);
NODE
