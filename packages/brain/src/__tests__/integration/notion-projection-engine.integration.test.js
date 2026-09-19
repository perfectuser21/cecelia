/** 真库火：migration 451 给 10 张镜子表补 notion_digest 列（引擎指纹槽） */
import { describe, it, expect, beforeAll } from 'vitest';
let pool;
beforeAll(async () => { pool = (await import('../../db.js')).default; });
describe('notion_digest 指纹列', () => {
  it('10 张由 notion-push-sync 推送的镜子表都有 notion_digest', async () => {
    const tables = ['issues','journeys','journey_features','journey_step_links','decisions','initiative_contracts','ops_agents','ops_skills','ops_workflows','ops_runs'];
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.columns WHERE column_name='notion_digest' AND table_name = ANY($1)`, [tables]);
    expect(rows.map(r => r.table_name).sort()).toEqual(tables.sort());
  });
});
