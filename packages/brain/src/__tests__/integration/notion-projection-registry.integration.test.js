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
  // 旧 AI Steps 推送链（notion-push-sync.pushJourneySteps，2026-06-09 退役）不得复活；
  // 迁移 482（决策 0834e2fb / 92f6226b）起 journey_steps=backbone_activities 只允许一条推送血管：
  // 「Backbone Activities」契约只读镜子，走 activity-contract-sync，不走旧 notion-push-sync 链。
  it('activities（原 journey_steps）：旧 AI Steps 行保持 archived/none；唯一推送血管是 Backbone Activities 契约镜子', async () => {
    const { rows } = await pool.query(
      `SELECT notion_db_id, status, direction, vessel FROM notion_projection_map WHERE brain_table='activities' ORDER BY notion_db_id`);
    const aiSteps = rows.find(r => r.notion_db_id === '369c40c2-ba63-812c-9f35-e7e43db25014');
    expect(aiSteps).toMatchObject({ status: 'archived', direction: 'none' });
    const pushing = rows.filter(r => ['push', 'both'].includes(r.direction) && r.status === 'active');
    expect(pushing).toHaveLength(1);
    expect(pushing[0]).toMatchObject({ notion_db_id: 'c213e387-b2ae-45a4-98c0-4a66fe3408be', vessel: 'activity-contract-sync.pushBackboneActivities' });
  });
});
