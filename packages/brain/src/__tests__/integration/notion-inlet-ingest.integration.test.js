/** 真库火：migration 452 收据表 + 注册表两条入口血管接通 */
import { describe, it, expect, beforeAll } from 'vitest';
let pool;
beforeAll(async () => { pool = (await import('../../db.js')).default; });
describe('入口血管落表', () => {
  it('notion_ingest_receipts 存在且以 notion_page_id 为主键', async () => {
    const { rows } = await pool.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='notion_ingest_receipts'::regclass AND i.indisprimary`);
    expect(rows.map(r => r.attname)).toEqual(['notion_page_id']);
  });
  it('注册表：「决策」与「Ai超级员工Skill库」由 pending_vessel 转 active，方向 ingest，血管 notion-inlet-ingest', async () => {
    const { rows } = await pool.query(`SELECT title, direction, status, vessel FROM notion_projection_map WHERE brain_table IN ('decisions','skill_evals') AND face='inlet'`);
    expect(rows).toHaveLength(2);
    for (const r of rows) { expect(r.status).toBe('active'); expect(r.direction).toBe('ingest'); expect(r.vessel).toMatch(/notion-inlet-ingest/); }
  });
});
