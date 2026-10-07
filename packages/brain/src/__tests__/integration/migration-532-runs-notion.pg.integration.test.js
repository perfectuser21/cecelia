/** 迁移 532 的行为：runs 增 Notion 记账列 + notion_projection_map 登记占位行 + schema_version。只读断言，事务里跑，结束回滚。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

let pool, client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

describe('迁移 532：runs 增 Notion 记账列 + 投影注册占位', () => {
  it('runs 有 notion_id / notion_synced_at / notion_digest 三列且类型正确', async () => {
    const { rows } = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='runs' AND column_name IN ('notion_id','notion_synced_at','notion_digest')
       ORDER BY column_name`);
    expect(rows).toEqual([
      { column_name: 'notion_digest', data_type: 'text' },
      { column_name: 'notion_id', data_type: 'text' },
      { column_name: 'notion_synced_at', data_type: 'timestamp with time zone' },
    ]);
  });

  it('notion_projection_map 对 runs 恰有 1 行占位：pending_vessel / direction=none', async () => {
    const { rows } = await client.query("SELECT * FROM notion_projection_map WHERE brain_table='runs'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      notion_db_id: 'unmapped:runs', direction: 'none', status: 'pending_vessel',
      title: '（无 Notion 库）最近执行',
    });
  });

  it('runs 有两个部分索引：OpenClaw 按任务名+时间、已挂 Notion 页按时间', async () => {
    const { rows } = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename='runs' AND indexname IN ('idx_runs_openclaw_ref_started','idx_runs_notion_started')
        ORDER BY indexname`);
    expect(rows.map((r) => r.indexname)).toEqual(['idx_runs_notion_started', 'idx_runs_openclaw_ref_started']);
    expect(rows[0].indexdef).toMatch(/started_at DESC\) WHERE \(notion_id IS NOT NULL\)/);
    expect(rows[1].indexdef).toMatch(/trigger_ref, started_at DESC\) WHERE \(run_id ~~ 'openclaw:%'::text\)/);
  });

  it('schema_version 记有 532', async () => {
    const { rows } = await client.query("SELECT version FROM schema_version WHERE version='532'");
    expect(rows).toHaveLength(1);
  });
});
