/**
 * 注册表真库火：migration 450 建表 + 种子，且每条登记的 brain_table 真有 notion_id 列。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { FACES } from '../../lib/notion-projection-registry.js';
let pool;
beforeAll(async () => { pool = (await import('../../db.js')).default; });

describe('notion_projection_map 注册表', () => {
  it('表存在且种子 ≥ 25 个编制库', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM notion_projection_map');
    expect(rows[0].n).toBeGreaterThanOrEqual(25);
  });
  it('face 全在三面之内，direction 合法', async () => {
    const { rows } = await pool.query('SELECT DISTINCT face, direction FROM notion_projection_map');
    for (const r of rows) {
      expect(FACES).toContain(r.face);
      expect(['push', 'ingest', 'both', 'none']).toContain(r.direction);
    }
  });
  it('由 notion-push-sync 承担血管的登记，其 brain_table 都真有 notion_id 列（不许登记纸门）', async () => {
    const { rows } = await pool.query(`
      SELECT m.brain_table FROM notion_projection_map m
      WHERE m.brain_table IS NOT NULL
        AND m.direction <> 'none'
        AND m.vessel LIKE 'notion-push-sync%'
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                        WHERE c.table_name = m.brain_table AND c.column_name = 'notion_id')`);
    expect(rows.map(r => r.brain_table)).toEqual([]);
  });
  it('已废弃的 journey_steps 只能是 archived/none，不能再是推送血管', async () => {
    const { rows } = await pool.query(`SELECT status, direction FROM notion_projection_map WHERE brain_table='journey_steps'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('none');
  });
});
