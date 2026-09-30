/**
 * [BEHAVIOR] GET /api/brain/learnings 的 ?date= 过滤必须先::timestamptz再转北京时间（任务 19684870）。
 *
 * 根因：learnings.created_at 是 timestamp without time zone，DB 里存的是 UTC 裸数字。
 * routes/ops.js 里 `DATE(created_at AT TIME ZONE 'Asia/Shanghai') = $date` 这条过滤 SQL，
 * 如果不先 ::timestamptz 转出正确的绝对时刻就直接 AT TIME ZONE，方向反了——在北京 0点~8点
 * 这个窗口附近（对应 UTC 前一天 16点~24点）会把记录筛进错误的一天。
 * 这个测试选边界值：created_at = UTC 2026-06-14T20:00:00Z，对应北京时间
 * 2026-06-15T04:00:00+08:00（凌晨4点，正处在方向反了会出错的窗口内）——不起完整 HTTP
 * server，直接测这条 SQL 表达式本身：真实 insert 一行、跑同款 WHERE 子句、断言边界值
 * 命中 date=2026-06-15、不命中 date=2026-06-14。不 mock，因为这个 bug 只在真实 pg
 * 会话时区转换路径上出现。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pool from '../../db.js';

const created = [];

afterAll(async () => {
  if (created.length) {
    await pool.query('DELETE FROM learnings WHERE id = ANY($1::uuid[])', [created]);
  }
  await pool.end().catch(() => {});
});

describe('routes/ops.js GET /api/brain/learnings ?date= 过滤 — created_at 必须先::timestamptz再转北京时间（任务 19684870）', () => {
  it('UTC 6-14 20:00（=北京 6-15 04:00）在 date=2026-06-15 命中，date=2026-06-14 不命中', async () => {
    const id = randomUUID();
    // UTC 周日 20:00 = 北京周一 04:00 —— 方向反了会被误判成 6-14 那天
    const createdAtUtc = new Date('2026-06-14T20:00:00.000Z');

    await pool.query(
      `INSERT INTO learnings (id, title, content, created_at)
       VALUES ($1, $2, 'boundary test content', $3::timestamptz)`,
      [id, `date-filter boundary test ${id}`, createdAtUtc.toISOString()],
    );
    created.push(id);

    // 与 routes/ops.js 同一条 WHERE 子句
    const whereSql = `DATE(created_at::timestamptz AT TIME ZONE 'Asia/Shanghai') = $2`;

    const { rows: hitRows } = await pool.query(
      `SELECT id FROM learnings WHERE id = $1 AND ${whereSql}`,
      [id, '2026-06-15'],
    );
    expect(hitRows.length, 'date=2026-06-15 应该命中这条北京时间凌晨4点创建的记录').toBe(1);

    const { rows: missRows } = await pool.query(
      `SELECT id FROM learnings WHERE id = $1 AND ${whereSql}`,
      [id, '2026-06-14'],
    );
    expect(missRows.length, 'date=2026-06-14 不应该命中——这条记录的北京时间是 6-15 凌晨4点，不是 6-14').toBe(0);
  });
});
