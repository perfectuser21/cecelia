/**
 * 真 Postgres 集成测试 — 价值流建模⑤ 迁移 493+（决策 3e867cad）。
 * 禁 mock 被改的边：probes / journey_step_links / golden_path* 全走真库（不 mock 任何被改的表）。
 * 需 brain-integration job 起真 Postgres；须登记进 packages/brain/vitest.config.js 的
 * POSTGRES_INTEGRATION_TESTS（generator 补登记）。落地前应 RED。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../../migrate.js';

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || process.env.DB_URL;

describe.skipIf(!DB_URL)('migration 493 probes/cells/golden_path (pg)', () => {
  /** @type {import('pg').Pool} */
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await runMigrations(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM probes WHERE probe_key LIKE 'pgit-%'").catch(() => {});
      await pool.end();
    }
  });

  it('probes target_type 回填 activity 且 step_probes 已消失', async () => {
    const r = await pool.query(
      "SELECT to_regclass('probes') IS NOT NULL AS has_probes, to_regclass('step_probes') IS NULL AS no_old",
    );
    expect(r.rows[0].has_probes).toBe(true);
    expect(r.rows[0].no_old).toBe(true);
    await pool.query(
      `INSERT INTO probes (probe_key,workflow,stage,spec,spec_hash,target_type,target_id)
       VALUES ('pgit-a','wf','st','{}'::jsonb,repeat('a',64),'activity',gen_random_uuid())
       ON CONFLICT (probe_key) DO NOTHING`,
    );
    const t = await pool.query("SELECT target_type FROM probes WHERE probe_key='pgit-a'");
    expect(t.rows[0].target_type).toBe('activity');
  });

  it('probes target_type CHECK 拒非法值', async () => {
    await expect(
      pool.query(
        `INSERT INTO probes (probe_key,workflow,stage,spec,spec_hash,target_type)
         VALUES ('pgit-bad','wf','st','{}'::jsonb,repeat('b',64),'bogus')`,
      ),
    ).rejects.toThrow();
  });

  it('journey_step_links target_type target_id 列可承载 step/enabler cell', async () => {
    const c = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='journey_step_links' AND column_name IN ('target_type','target_id')",
    );
    expect(c.rows[0].n).toBe(2);
  });

  it('golden_path golden_paths golden_path_contract_versions 三表 to_regclass NULL', async () => {
    const r = await pool.query(
      "SELECT to_regclass('golden_path') IS NULL AND to_regclass('golden_paths') IS NULL AND to_regclass('golden_path_contract_versions') IS NULL AS dropped",
    );
    expect(r.rows[0].dropped).toBe(true);
  });

  it('notion_projection_map 注册 steps enablers 投影目标', async () => {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM notion_projection_map WHERE brain_table IN ('steps','enablers') AND status='active' AND direction IN ('push','both')",
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
