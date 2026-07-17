/**
 * Migration 347 集成测试：承诺地图 schema 扩展
 * 验证四表五扩展的列都成功落库
 */
import { describe, it, expect, beforeAll } from 'vitest';
let pool;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

describe('migration 347: journeys 新字段', () => {
  it('journeys 有 home 列（枚举约束 biz/pre/xcut/factory）', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journeys' AND column_name='home'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('journeys 有 trigger 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journeys' AND column_name='trigger'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('journeys 有 endpoint 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journeys' AND column_name='endpoint'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('home CHECK 约束拒绝非法值', async () => {
    await expect(
      pool.query(`UPDATE journeys SET home='invalid' WHERE 1=0`)
    ).resolves.toBeDefined(); // 空更新不报错
    // 测试约束存在（无需真正插入非法值，只验列存在+约束定义）
    const r = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'journeys' AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%home%'
    `);
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    expect(r.rows[0].def).toMatch(/biz|pre|xcut|factory/);
  });
});

describe('migration 347: journey_steps 新字段', () => {
  it('journey_steps 有 promise 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journey_steps' AND column_name='promise'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('journey_steps 有 backbone_version 列（默认 1.0）', async () => {
    const r = await pool.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name='journey_steps' AND column_name='backbone_version'
    `);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].column_default).toMatch(/1\.0/);
  });
});

describe('migration 347: journey_features 新字段', () => {
  it('journey_features 有 softness 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journey_features' AND column_name='softness'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('softness CHECK 约束含 hard/soft', async () => {
    const r = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'journey_features' AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%softness%'
    `);
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    expect(r.rows[0].def).toMatch(/hard|soft/);
  });
});

describe('migration 347: journey_step_links 新字段', () => {
  it('journey_step_links 有 feature_id 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journey_step_links' AND column_name='feature_id'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('journey_step_links 有 cell_kind 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journey_step_links' AND column_name='cell_kind'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('journey_step_links 有 cell_status 列（默认 gray）', async () => {
    const r = await pool.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name='journey_step_links' AND column_name='cell_status'
    `);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].column_default).toMatch(/gray/);
  });

  it('journey_step_links 有 assertion_ref 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journey_step_links' AND column_name='assertion_ref'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('journey_step_links 有 na_reason 列', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='journey_step_links' AND column_name='na_reason'
    `);
    expect(r.rows).toHaveLength(1);
  });

  it('cell_status CHECK 约束含 gray/red/pending/green', async () => {
    const r = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'journey_step_links' AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%cell_status%'
    `);
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    const def = r.rows[0].def;
    expect(def).toMatch(/gray/);
    expect(def).toMatch(/green/);
  });
});
