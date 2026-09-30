/**
 * [BEHAVIOR] timestamp without time zone 列读取必须是真实 UTC 语义（任务 19684870）。
 *
 * 根因：node-pg 的 postgres-date 解析器对不带时区后缀的 timestamp 文本，落进
 * `new Date(year, month, day, ...)` 分支——用进程本地时区（容器 TZ=Asia/Shanghai）
 * 解释这些本来就是 UTC 的裸数字，读出来的 JS Date 比真实时刻早 8 小时。
 * 这个测试直接写一个已知 UTC 时刻进 tasks.started_at，再用真实连接池读出来，
 * 断言往返不丢时区语义——不 mock，因为这个 bug 只在真实 pg 驱动解析路径上出现。
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

describe('tasks.started_at — timestamp without time zone 必须按 UTC 解析（任务 19684870）', () => {
  it('写入已知 UTC 时刻，真实连接池读出的 JS Date 必须与写入值一致（不偏移8小时）', async () => {
    const id = randomUUID();
    // 故意选一个"减8小时"和"不减"差异肉眼可辨的时刻
    const knownUtc = new Date('2026-06-15T10:30:00.000Z');
    await pool.query(
      `INSERT INTO tasks (id, title, task_type, status, started_at)
       VALUES ($1, $2, 'data', 'queued', $3::timestamptz)`,
      [id, `utc roundtrip test ${id}`, knownUtc.toISOString()],
    );
    created.push(id);

    const { rows: [row] } = await pool.query('SELECT started_at FROM tasks WHERE id = $1', [id]);

    expect(
      row.started_at.getTime(),
      `读出来的 started_at(${row.started_at.toISOString()}) 与写入的 UTC 时刻` +
        `(${knownUtc.toISOString()}) 必须一致——差 8 小时说明 postgres-date 解析器` +
        `又把这个 timestamp without time zone 列的裸数字当成本地时区(Asia/Shanghai)解析了`,
    ).toBe(knownUtc.getTime());
  });
});
