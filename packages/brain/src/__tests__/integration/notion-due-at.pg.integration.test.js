import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import pool from '../../db.js';
import { applyOwnerStops } from '../../notion-gtd-sync.js';

vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));

afterAll(() => pool.end());

// 真实 PostgreSQL 事务，所有验收行最终回滚；Notion 仅替换外部网络边界。
async function scenario(fn) {
  const client = await pool.connect();
  const id = randomUUID();
  const pageId = randomUUID();
  const start = '2030-10-03T09:00:00Z';
  const retry = '2030-10-04T09:00:00Z';
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query(
      `INSERT INTO tasks(id,title,task_type,status,payload,due_at,notion_props)
       VALUES($1,'Notion截止同步回归验收','qiumi_task','queued',$2::jsonb,
              '2030-10-03 10:00:00','{"qiumi_pushed_status":"queued","preserved":true}')`,
      [id, JSON.stringify({ notion_zh_page_id: pageId, scheduled_start: start, next_run_at: retry })],
    );
    const sync = async (end, { startAt = start, sourcePageId = pageId, beforeUpdate } = {}) => {
      const page = { id: sourcePageId, properties: {
        'OpenClaw任务号': { rich_text: [{ plain_text: `brain:${id}` }] },
        '预期开始时间': { date: startAt ? { start: startAt } : null },
        '预期结束时间': { date: end ? { start: end } : null },
      } };
      const notionReq = async (_token, _path, _method, body) => ({
        results: body.filter.and[0].status.equals === '委派' ? [page] : [],
      });
      const db = { query: async (sql, params) => {
        if (/UPDATE tasks/.test(sql) && beforeUpdate) await beforeUpdate(client);
        return client.query(sql, params);
      } };
      return applyOwnerStops(db, 'tok', { notionReq, now: () => new Date('2030-10-01T00:00:00Z') });
    };
    const read = async () => (await client.query('SELECT due_at,payload,notion_props,status FROM tasks WHERE id=$1', [id])).rows[0];
    await fn({ client, id, sync, read, start, retry });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('Notion截止改期 — 真实PG', () => {
  it('只改结束保持重试退避；日期按上海日终存UTC；清空写NULL；重复同步幂等', async () => {
    await scenario(async ({ sync, read, start, retry }) => {
      expect((await sync('2030-10-05')).rescheduled).toBe(1);
      const row = await read();
      expect(row.due_at.toISOString()).toBe('2030-10-05T15:59:59.000Z');
      expect(row.payload).toMatchObject({ scheduled_start: start, next_run_at: retry });
      expect(row.notion_props).toEqual({ preserved: true });
      expect((await sync('2030-10-05T23:59:59+08:00')).rescheduled).toBe(0);
      expect((await sync(null)).rescheduled).toBe(1);
      expect((await read()).due_at).toBeNull();
      expect((await sync(null)).rescheduled).toBe(0);
    });
  });

  it.each(['UTC', 'Asia/Shanghai'])('数据库会话时区=%s，due_at仍是真实UTC数字', async (tz) => {
    await scenario(async ({ client, sync, read }) => {
      await client.query(`SET LOCAL TIME ZONE '${tz}'`);
      expect((await sync('2030-10-05T18:00:00+08:00')).rescheduled).toBe(1);
      expect((await read()).due_at.toISOString()).toBe('2030-10-05T10:00:00.000Z');
    });
  });

  it('复制页串号、任务类型不符与并发派发均不能改期', async () => {
    await scenario(async ({ id, client, sync, read }) => {
      expect((await sync('2030-10-05', { sourcePageId: randomUUID() })).rescheduled).toBe(0);
      await client.query("UPDATE tasks SET task_type='data' WHERE id=$1", [id]);
      expect((await sync('2030-10-05')).rescheduled).toBe(0);
      await client.query("UPDATE tasks SET task_type='qiumi_task' WHERE id=$1", [id]);
      const result = await sync('2030-10-05', { beforeUpdate: async () => {
        await client.query("UPDATE tasks SET status='in_progress' WHERE id=$1", [id]);
      } });
      expect(result.rescheduled).toBe(0);
      expect((await read()).due_at.toISOString()).toBe('2030-10-03T10:00:00.000Z');
    });
  });
});
