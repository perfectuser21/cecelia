/**
 * escalation-cancel-pending-sql.integration.test.js
 *
 * 回归守卫 —— 紧急制动 cancel_pending 的 SQL $3 参数类型推断修复
 *
 * 事故现场（2026-08-05 实测）：Brain 因 CPU 83% 触发 emergency_brake，
 * stop_dispatch 生效，但紧接着的 cancel_pending 崩了：
 *   [Escalation] Action failed: cancel_pending
 *   error: could not determine data type of parameter $3
 * 结果熔断只成功一半——派发停了，待处理任务没被暂停。
 *
 * 根因：$3 同时出现在 `error_message = $3`（text 上下文）与
 * `jsonb_build_object(..., 'source', $3)`（"any" 上下文）。jsonb_build_object
 * 的形参是 any，Postgres 无法据此推断，整条语句 PREPARE 阶段即失败。
 *
 * 为什么之前的测试没抓住：既有 escalation 单测 mock 了 pool.query，
 * SQL 从未真正被 Postgres 解析。这与本仓 autoblock-sql-integration.test.js
 * 记录的教训同源（上次是 $2）——**禁止 mock pool.query**，必须真库 PREPARE。
 *
 * 归属：brain-integration job（带真 postgres service）。放这里而非 src/__tests__/ 根目录，
 * 因为 brain-unit 分片无 DB 且显式 --exclude='src/__tests__/integration/**'——2026-08-05
 * 首次提交误放根目录，CI 报 AggregateError(pg-pool 连不上库) 而非 SQL 错，已修正。
 *
 * 运行（需真实 PG）：
 *   DATABASE_URL=postgresql://localhost/cecelia_test \
 *     npx vitest run packages/brain/src/__tests__/integration/escalation-cancel-pending-sql.integration.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { buildCancelPendingQuery, buildPauseLowPriorityQuery } from '../../alertness/escalation.js';

const DB_URL = process.env.DATABASE_URL
  || process.env.BRAIN_DB_URL
  || 'postgresql://localhost/cecelia';

let pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
});

afterAll(async () => {
  await pool?.end();
});

/**
 * PREPARE 时**故意只声明前两个参数的类型**，把 $3 留给服务器自行推断——
 * 这是本守卫能否抓到事故的唯一关键，2026-08-05 变异测试连踩两次坑才定型：
 *   ✗ client.query(sql, values)：pg 驱动在 Parse 消息里替服务器把类型定死，
 *     服务器不做推断，裸 $3 照样过——守卫是虚的。
 *   ✗ PREPARE name(text[], text[], text)：显式声明 $3 是 text，同样绕过推断。
 *   ✓ PREPARE name(text[], text[])：$3 无声明 → 服务器必须从语句内用法推断
 *     → 裸 $3 落进 jsonb_build_object(any) 立即报 could not determine data type。
 * 实测：变异态(裸 $3) 报错、修复态($3::text) 通过，干净区分。
 */
async function prepareWithUninferredThirdParam(pool, sql, name) {
  const client = await pool.connect();
  try {
    await client.query(`PREPARE ${name}(text[], text[]) AS ${sql}`);
    await client.query(`DEALLOCATE ${name}`);
    return true;
  } finally {
    client.release();
  }
}

describe('cancel_pending SQL 参数类型（真库 PREPARE，禁 mock）', () => {
  it('keepCritical=false 的 SQL 能被 Postgres 成功 PREPARE（$3 类型可推断）', async () => {
    const sql = buildCancelPendingQuery(false);
    await expect(prepareWithUninferredThirdParam(pool, sql, 'guard_cancel_pending_f')).resolves.toBe(true);
  });

  it('keepCritical=true 的 SQL 同样能被成功 PREPARE', async () => {
    const sql = buildCancelPendingQuery(true);
    await expect(prepareWithUninferredThirdParam(pool, sql, 'guard_cancel_pending_t')).resolves.toBe(true);
  });

  it('SQL 里每一处 $3 都带显式 text 标注（防再次出现裸 $3 进 any 上下文）', () => {
    const sql = buildCancelPendingQuery(false);
    // 找出所有 $3 出现处，逐个确认紧跟 ::text
    const bareDollar3 = sql.match(/\$3(?!::text)/g) || [];
    expect(bareDollar3).toEqual([]);
  });

  // ── pause_low_priority（L1 优雅降级）——修 cancel_pending 时发现的同源哑弹 ──
  it('pause_low_priority 的 SQL 同样能被成功 PREPARE（$3 类型可推断）', async () => {
    const sql = buildPauseLowPriorityQuery();
    await expect(prepareWithUninferredThirdParam(pool, sql, 'guard_pause_low')).resolves.toBe(true);
  });

  it('pause_low_priority SQL 里每一处 $3 都带显式 text 标注', () => {
    const bareDollar3 = buildPauseLowPriorityQuery().match(/\$3(?!::text)/g) || [];
    expect(bareDollar3).toEqual([]);
  });

  it('keepCritical=true 时保留 P0（不误伤最高优先级任务）', () => {
    expect(buildCancelPendingQuery(true)).toMatch(/priority\s*!=\s*'P0'/);
    expect(buildCancelPendingQuery(false)).not.toMatch(/priority\s*!=\s*'P0'/);
  });

  it('SQL 是可逆 paused 而非终态 canceled（2026-07-09 Issue 9db1da44 不回归）', () => {
    const sql = buildCancelPendingQuery(false);
    expect(sql).toMatch(/status\s*=\s*'paused'/);
    expect(sql).not.toMatch(/status\s*=\s*'canceled'/);
  });
});
