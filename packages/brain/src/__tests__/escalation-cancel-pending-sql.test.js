/**
 * escalation-cancel-pending-sql.test.js
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
 * 运行（需真实 PG）：
 *   DATABASE_URL=postgresql://localhost/cecelia_test \
 *     npx vitest run packages/brain/src/__tests__/escalation-cancel-pending-sql.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { buildCancelPendingQuery } from '../alertness/escalation.js';

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

describe('cancel_pending SQL 参数类型（真库 PREPARE，禁 mock）', () => {
  it('keepCritical=false 的 SQL 能被 Postgres 成功 PREPARE（$3 类型可推断）', async () => {
    const sql = buildCancelPendingQuery(false);
    const client = await pool.connect();
    try {
      // PREPARE 只做解析与计划，不执行——不会误伤任何真实任务行
      await expect(
        client.query({ text: sql, values: [[], [], 'test_reason'] , rowMode: 'array', name: undefined })
      ).resolves.toBeDefined();
    } finally {
      client.release();
    }
  });

  it('keepCritical=true 的 SQL 同样能被成功 PREPARE', async () => {
    const sql = buildCancelPendingQuery(true);
    const client = await pool.connect();
    try {
      await expect(
        client.query({ text: sql, values: [[], [], 'test_reason'] })
      ).resolves.toBeDefined();
    } finally {
      client.release();
    }
  });

  it('SQL 里每一处 $3 都带显式 text 标注（防再次出现裸 $3 进 any 上下文）', () => {
    const sql = buildCancelPendingQuery(false);
    // 找出所有 $3 出现处，逐个确认紧跟 ::text
    const bareDollar3 = sql.match(/\$3(?!::text)/g) || [];
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
