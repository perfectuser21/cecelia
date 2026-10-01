import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import pool from '../../db.js';
import { applyOwnerStops } from '../../notion-gtd-sync.js';
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));
afterAll(() => pool.end());
async function scenario(fn) {
  const client = await pool.connect();
  const id = randomUUID(); const pageId = randomUUID(); const nickname = `验收手机${id}`;
  const serial = `test-${id}`; const source = { title: '抖音回归验收', remark: '', body: '手机：未知' };
  const payload = { notion_zh_page_id: pageId, qiumi_source: source, qiumi_route: { stale: true }, run_id: 'old',
    next_run_at: '2030-10-04T09:00:00Z', scheduled_start: '2030-10-03T09:00:00Z', headed_manual: true,
    routing_receipt_id: randomUUID(), work_kind: 'operations', custom: { preserved: true } };
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('INSERT INTO phone_registry(serial,nickname,douyin_accounts) VALUES($1,$2,$3::jsonb)',
      [serial, nickname, JSON.stringify([{ nickname: `验收账号${id}` }])]);
    await client.query(`INSERT INTO tasks(id,title,task_type,status,blocked_reason,blocked_at,payload,due_at,notion_props)
      VALUES($1,$2,'qiumi_task','blocked','device_unresolved',NOW(),$3::jsonb,'2030-10-05 09:00:00',
      '{"qiumi_pushed_status":"blocked","preserved":true}')`, [id, `设备重路由验收${id}`, JSON.stringify(payload)]);
    const text = (s) => [{ plain_text: s }];
    const page = { id: pageId, last_edited_time: '2030-10-01T00:00:00Z', last_edited_by: { object: 'user', id: randomUUID(), type: 'person' }, properties: {
      '名称': { title: text(source.title) }, '备注': { rich_text: [] },
      'OpenClaw任务号': { rich_text: text(`brain:${id}`) }, '状态': { status: { name: '进行中' } },
    } };
    let transactionNo = 0;
    const sync = async ({ beforeUpdate, failEvent, status, content = `手机：${nickname}` } = {}) => {
      page.properties['状态'].status.name = status ?? '进行中';
      const notionReq = async (_token, path, method) => {
        if (method === 'POST') return { results: [] };
        if (path.startsWith('/pages/')) return page;
        return { results: [{ type: 'paragraph', paragraph: { rich_text: text(content) } }] };
      };
      const db = { query: async (sql, args) => {
        if (/UPDATE tasks/.test(sql) && beforeUpdate) await beforeUpdate(client);
        if (/INSERT INTO task_events/.test(sql) && failEvent) return client.query(sql, [args[0], null, args[2]]);
        return client.query(sql, args);
      }, connect: async () => {
        const savepoint = `reroute_fixture_${++transactionNo}`;
        return { release() {}, query: async (sql, args) => {
          // 测试外层BEGIN负责隔离数据；将生产独立client事务映射到真PG子事务，保持故障回滚可读。
          if (sql === 'BEGIN') return client.query(`SAVEPOINT ${savepoint}`);
          if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          if (sql === 'ROLLBACK') {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          }
          return db.query(sql, args);
        } };
      } };
      return applyOwnerStops(db, 'tok', { notionReq });
    };
    const read = async () => (await client.query('SELECT status,payload,due_at,notion_props,blocked_reason FROM tasks WHERE id=$1', [id])).rows[0];
    const events = async () => (await client.query("SELECT payload FROM task_events WHERE task_id=$1 AND event_type='qiumi_device_rerouted'", [id])).rows;
    await fn({ client, id, pageId, sync, read, events, payload, nickname, serial });
  } finally { await client.query('ROLLBACK'); client.release(); }
}
describe('Notion设备补写重路由 — 真PG原task验收', () => {
  it.each(['手机', '账号'])('%s补写更新原task一次，真实payload/事件/截止保留，重复同步幂等', async (field) => {
    await scenario(async ({ client, id, sync, read, events, payload, nickname, serial }) => {
      const content = field === '账号' ? `账号：验收账号${id}` : `手机：${nickname}`;
      expect((await sync({ content })).rerouted).toBe(1);
      const row = await read(); expect(row.status).toBe('queued'); expect(row.blocked_reason).toBeNull();
      expect(row.payload).toMatchObject({ next_run_at: payload.next_run_at, scheduled_start: payload.scheduled_start,
        headed_manual: true, routing_receipt_id: payload.routing_receipt_id, custom: payload.custom });
      expect(row.payload.qiumi_route).toBeUndefined(); expect(row.payload.run_id).toBeUndefined();
      expect(row.payload.qiumi_source.body).toBe(content);
      expect(row.due_at.toISOString()).toBe('2030-10-05T09:00:00.000Z');
      expect(row.notion_props).toEqual({ preserved: true });
      expect(await events()).toHaveLength(1); expect((await events())[0].payload.serial).toBe(serial);
      expect((await sync()).rerouted).toBe(0);
      expect((await client.query("SELECT id FROM tasks WHERE payload->>'notion_zh_page_id'=$1", [payload.notion_zh_page_id])).rows).toEqual([{ id }]);
    });
  });
  it('人工阻塞/多义/型号维持退回，不留成功事件', async () => {
    await scenario(async ({ sync, read, events }) => {
      expect((await sync({ status: '阻塞' })).rerouted).toBe(0);
      expect((await sync({ content: '型号：红米Note12' })).rerouted).toBe(0);
      expect((await read()).status).toBe('blocked'); expect(await events()).toHaveLength(0);
    });
  });
  it('真实PG事件INSERT非空约束失败，原blocked/source/cache及非路由payload全部保持', async () => {
    await scenario(async ({ sync, read, events }) => {
      const original = await read();
      expect((await sync({ failEvent: true })).rerouted).toBe(0);
      expect(await read()).toEqual(original); expect(await events()).toHaveLength(0);
    });
  });
  it.each(['status', 'source'])('读取后并发变更%s CAS不能覆盖', async (kind) => {
    await scenario(async ({ client, id, sync, read, events }) => {
      expect((await sync({ beforeUpdate: async () => {
        if (kind === 'status') await client.query("UPDATE tasks SET status='in_progress' WHERE id=$1", [id]);
        else await client.query("UPDATE tasks SET payload=jsonb_set(payload,'{qiumi_source,body}','\"human newer\"') WHERE id=$1", [id]);
      } })).rerouted).toBe(0);
      expect((await read()).payload.run_id).toBe('old'); expect(await events()).toHaveLength(0);
    });
  });
});
