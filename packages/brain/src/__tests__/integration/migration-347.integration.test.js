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

describe('migration 347: promise map schema', () => {
  it('journeys 新列 home/domain/trigger/endpoint', async () => {
    const c = await cols('journeys');
    for (const k of ['home', 'domain', 'trigger', 'endpoint']) expect(c[k], k).toBeDefined();
  });

  it('journey_steps 新列 promise/backbone_version', async () => {
    const c = await cols('journey_steps');
    expect(c.promise).toBeDefined();
    expect(c.backbone_version).toBe('NO'); // NOT NULL DEFAULT 1
  });

  it('journey_features 新列 softness', async () => {
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

  it('journey_step_links 格子列全齐且 step_order 可空', async () => {
    const c = await cols('journey_step_links');
    for (const k of ['feature_id', 'cell_kind', 'cell_key', 'cell_status', 'assertion_ref', 'na_reason'])
      expect(c[k], k).toBeDefined();
    expect(c.step_order).toBe('YES');
  });

  it('旧 UNIQUE(journey_id,step_id) 已删，两个 partial unique + feature 索引已建', async () => {
    const { rows: cons } = await pool.query(`
      SELECT conname FROM pg_constraint WHERE conname='journey_step_links_journey_id_step_id_key'`);
    expect(cons).toHaveLength(0);
    const { rows: idx } = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename='journey_step_links'`);
    const names = idx.map(r => r.indexname);
    expect(names).toContain('uq_jsl_membership');
    expect(names).toContain('uq_jsl_cell');
    expect(names).toContain('idx_jsl_feature');
  });

  it('journey_step_links 三个 CHECK 约束（cell_kind/cell_status/cell_key_required）已建', async () => {
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
      WHERE t.relname='journey_step_links' AND c.contype='c'`);
    const names = rows.map(r => r.conname);
    expect(names).toContain('jsl_cell_kind_check');
    expect(names).toContain('jsl_cell_status_check');
    expect(names).toContain('jsl_cell_key_required');
  });
});
