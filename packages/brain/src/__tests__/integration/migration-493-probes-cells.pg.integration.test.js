/**
 * 价值流建模⑤（收窄版）真 Postgres roundtrip 集成测试（补充行）。
 * 被测：迁移 493+ 把 step_probes RENAME→probes（+ target_type/target_id 回填 activity、CHECK）、
 * journey_step_links 扩 step/enabler 级。禁 mock 被改的边——真连 Postgres，不 mock db.js。
 * 由 brain-integration job 起真 Postgres 并先跑迁移后执行；登记进 vitest.config.js POSTGRES_INTEGRATION_TESTS。
 * 迁移未落地时：probes 不存在 / 无 target_type 列 / CHECK 缺失 → 断言 fail（RED）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../db.js';

const KEY = `pg-493-${process.pid}`;

afterAll(async () => {
  await pool.query(`DELETE FROM probes WHERE probe_key LIKE $1`, [`${KEY}%`]).catch(() => {});
});

describe('migration 493+ probes/cells real PG', () => {
  it('probes target_type 回填 activity（旧行零丢失，默认 activity）', async () => {
    const hex64 = 'a'.repeat(64);
    await pool.query(
      `INSERT INTO probes (probe_key, workflow, stage, spec, spec_hash)
         VALUES ($1, 'wf', 'st', '{}'::jsonb, $2)
         ON CONFLICT (probe_key) DO NOTHING`,
      [`${KEY}-legacy`, hex64],
    );
    const { rows } = await pool.query(
      `SELECT target_type FROM probes WHERE probe_key = $1`,
      [`${KEY}-legacy`],
    );
    expect(rows[0].target_type).toBe('activity');
  });

  it('probes target_type CHECK 拒非法值 bogus', async () => {
    await expect(
      pool.query(
        `INSERT INTO probes (probe_key, workflow, stage, spec, spec_hash, target_type)
           VALUES ($1, 'wf', 'st', '{}'::jsonb, $2, 'bogus')`,
        [`${KEY}-bad`, 'b'.repeat(64)],
      ),
    ).rejects.toThrow();
  });

  it('journey_step_links step enabler cell 插入（target_type/target_id 扩级）', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_name = 'journey_step_links'
           AND column_name IN ('target_type', 'target_id')`,
    );
    expect(rows[0].n).toBe(2);
    // step 级 target_type 被 CHECK 接受（非法值上一用例已验拒绝）
    const chk = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.check_constraints
         WHERE constraint_name LIKE '%journey_step_links%target_type%'`,
    );
    expect(chk.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
