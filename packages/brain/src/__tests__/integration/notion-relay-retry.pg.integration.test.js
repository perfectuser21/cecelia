import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'isolated' }));
import { ingestDecisionsInlet } from '../../notion-inlet-ingest.js';
const pool = new pg.Pool(DB_DEFAULTS);
let pageId, root, decision;
const page = () => ({ id: pageId, last_edited_time: '2026-11-04T00:00:00Z', properties: {
  '决策': { title: [{ plain_text: `续棒重试合同-${decision}` }] },
  '状态': { select: { name: '已决定' } },
  '结论': { rich_text: [{ plain_text: '执行已批准方案' }] },
} });
const ingest = () => ingestDecisionsInlet(pool, 'isolated', {
  dbId: randomUUID(), notionReq: async () => ({ results: [page()] }), log: { warn() {} },
});
beforeEach(async () => {
  pageId = randomUUID(); root = randomUUID(); decision = randomUUID();
  await pool.query(`INSERT INTO tasks(id,title,task_type,status) VALUES($1,$2,'research','in_progress')`, [root, `续棒根-${root}`]);
  await pool.query(`INSERT INTO decisions(id,topic,decision,status,trigger,notion_id,context)
    VALUES($1,'待拍板','待拍板','pending','handoff',$2,$3)`, [decision, pageId, { root_task_id: root }]);
});
afterAll(async () => {
  await pool.query('DROP TRIGGER IF EXISTS frontier3_fail_relay ON tasks');
  await pool.query('DROP FUNCTION IF EXISTS frontier3_fail_relay()');
  await pool.end();
});
describe('拍板续棒真实PG原子性与重放', () => {
  it('建棒失败不确认收据，后续重试只登记一棒', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION frontier3_fail_relay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.parent_task_id='${root}'::uuid THEN RAISE EXCEPTION 'controlled relay insert failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER frontier3_fail_relay BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION frontier3_fail_relay()`);
    try {
      expect(await ingest()).toMatchObject({ failed: 1, resolved: 0 });
      expect((await pool.query('SELECT status FROM decisions WHERE id=$1', [decision])).rows[0].status).toBe('pending');
      expect((await pool.query('SELECT * FROM notion_ingest_receipts WHERE notion_page_id=$1', [pageId])).rows).toHaveLength(0);
    } finally { await pool.query('DROP TRIGGER frontier3_fail_relay ON tasks'); }
    expect(await ingest()).toMatchObject({ failed: 0, resolved: 1 });
    expect(await ingest()).toMatchObject({ skipped: 1 });
    expect((await pool.query('SELECT * FROM tasks WHERE parent_task_id=$1', [root])).rows).toHaveLength(1);
    expect((await pool.query('SELECT * FROM notion_ingest_receipts WHERE notion_page_id=$1', [pageId])).rows).toHaveLength(1);
  });
  it('两个入口并发消费同一拍板只确认一次且只建一棒', async () => {
    const results = await Promise.all([ingest(), ingest()]);
    expect(results.reduce((n, r) => n + r.resolved, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.skipped, 0)).toBe(1);
    expect((await pool.query('SELECT * FROM tasks WHERE parent_task_id=$1', [root])).rows).toHaveLength(1);
  });
});
