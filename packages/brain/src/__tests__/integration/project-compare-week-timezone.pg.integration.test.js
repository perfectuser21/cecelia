/**
 * [BEHAVIOR] project-compare.js 的按周趋势统计必须按北京时间分桶，不能方向反了（任务 19684870）。
 *
 * 根因：tasks.completed_at 是 timestamp without time zone，DB 里存的是 UTC 裸数字。
 * 旧 SQL `completed_at AT TIME ZONE 'Asia/Shanghai'` 没有先 ::timestamptz 转出正确的
 * 绝对时刻，就直接把这些 UTC 裸数字当成"已经是上海时间"来转——方向反了。
 * 这个测试选一个边界值：completed_at = UTC 2026-06-14T20:00:00Z，对应北京时间
 * 2026-06-15T04:00:00+08:00（周一凌晨）——如果方向反了，会被错误分进 UTC 6-14（周日）
 * 所在的那一周；修好之后必须分进北京时间 6-15（周一）所在的那一周。
 * 直接跑 project-compare.js 里那条 to_char SQL 片段本身，不 mock，因为这个 bug 只在
 * 真实 pg 会话时区转换路径上出现。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pool from '../../db.js';

const created = [];

afterAll(async () => {
  if (created.length) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [created]);
  }
  await pool.end().catch(() => {});
});

describe('project-compare.js 按周趋势统计 — completed_at 必须先::timestamptz再转北京时间（任务 19684870）', () => {
  it('UTC 6-14 20:00（=北京 6-15 04:00）必须分进北京 6-15 所在的那一周，不是 UTC 6-14 那一周', async () => {
    const id = randomUUID();
    const projectId = randomUUID();
    // UTC 周日 20:00 = 北京周一 04:00 —— ISO 周边界值，方向反了会分错周
    const completedAtUtc = new Date('2026-06-14T20:00:00.000Z');

    await pool.query(
      `INSERT INTO tasks (id, title, task_type, status, project_id, completed_at)
       VALUES ($1, $2, 'data', 'completed', $3, $4::timestamptz)`,
      [id, `week-timezone boundary test ${id}`, projectId, completedAtUtc.toISOString()],
    );
    created.push(id);

    const { rows: [row] } = await pool.query(
      `SELECT to_char(completed_at::timestamptz AT TIME ZONE 'Asia/Shanghai', 'IYYY-"W"IW') AS week
       FROM tasks WHERE id = $1`,
      [id],
    );

    // 期望值：直接用已知正确的北京时间边界值（2026-06-15T04:00:00+08:00）算出的 ISO 周
    const { rows: [expected] } = await pool.query(
      `SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai', 'IYYY-"W"IW') AS week`,
      ['2026-06-15T04:00:00+08:00'],
    );
    // 方向反了的错误值：把 completed_at 的裸文本直接当成已经是上海时间（不做 ::timestamptz 转换）
    const { rows: [wrongDirection] } = await pool.query(
      `SELECT to_char(completed_at AT TIME ZONE 'Asia/Shanghai', 'IYYY-"W"IW') AS week
       FROM tasks WHERE id = $1`,
      [id],
    );

    expect(wrongDirection.week, '方向反了的算法应该会算出跟正确值不同的周（否则这个边界值选得不够刁钻）').not.toBe(expected.week);
    expect(row.week, `project-compare.js 里的 SQL 片段算出的周(${row.week})必须等于北京时间边界值的周(${expected.week})，不能等于方向反了的周(${wrongDirection.week})`).toBe(expected.week);
  });
});
