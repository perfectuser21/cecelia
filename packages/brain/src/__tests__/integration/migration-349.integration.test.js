import { describe, it, expect, beforeAll } from 'vitest';
let pool;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

async function cols(table) {
  const { rows } = await pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name=$1`, [table]
  );
  return Object.fromEntries(rows.map(r => [r.column_name, r.is_nullable]));
}

describe('migration 349: promise map 和解补齐（348 thin 版之上）', () => {
  it('journeys 列齐全 home/domain/trigger/endpoint（domain 由 349 补）', async () => {
    const c = await cols('journeys');
    for (const k of ['home', 'domain', 'trigger', 'endpoint']) expect(c[k], k).toBeDefined();
  });

  it('journey_steps.backbone_version 已归一为 NOT NULL', async () => {
    const c = await cols('journey_steps');
    expect(c.promise).toBeDefined();
    expect(c.backbone_version).toBe('NO'); // 349 归一：SET NOT NULL DEFAULT '1.0'
  });

  it('journey_features.softness 已归一为 NOT NULL', async () => {
    const c = await cols('journey_features');
    expect(c.softness).toBe('NO');
  });

  it('journeys_home_check 与 journey_features_softness_check 已建 CHECK 约束', async () => {
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
      WHERE t.relname IN ('journeys','journey_features') AND c.contype='c'`);
    const names = rows.map(r => r.conname);
    expect(names).toContain('journeys_home_check');
    expect(names).toContain('journey_features_softness_check');
  });

  it('journey_step_links 格子列全齐（cell_key 由 349 补）且 step_order 可空', async () => {
    const c = await cols('journey_step_links');
    for (const k of ['feature_id', 'cell_kind', 'cell_key', 'cell_status', 'assertion_ref', 'na_reason'])
      expect(c[k], k).toBeDefined();
    expect(c.step_order).toBe('YES');
  });

  it('旧 UNIQUE(journey_id,step_id) 已删，两个 partial unique 已建（一步多格子）', async () => {
    const { rows: cons } = await pool.query(`
      SELECT conname FROM pg_constraint WHERE conname='journey_step_links_journey_id_step_id_key'`);
    expect(cons).toHaveLength(0);
    const { rows: idx } = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename='journey_step_links'`);
    const names = idx.map(r => r.indexname);
    expect(names).toContain('uq_jsl_membership');
    expect(names).toContain('uq_jsl_cell');
    expect(names).toContain('idx_jsl_feature_id'); // 348 已建，349 沿用
  });

  it('cell_kind 与 cell_key_required CHECK 已建（cell_status CHECK 由 348 内联提供）', async () => {
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
      WHERE t.relname='journey_step_links' AND c.contype='c'`);
    const names = rows.map(r => r.conname);
    expect(names).toContain('jsl_cell_kind_check');
    expect(names).toContain('jsl_cell_key_required');
    expect(names.some(n => n.includes('cell_status'))).toBe(true);
  });

  it('feature_id FK 为 ON DELETE SET NULL（349 由 NO ACTION 改）', async () => {
    const { rows } = await pool.query(`
      SELECT confdeltype FROM pg_constraint
      WHERE conname='journey_step_links_feature_id_fkey'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].confdeltype).toBe('n'); // n = SET NULL
  });
});
