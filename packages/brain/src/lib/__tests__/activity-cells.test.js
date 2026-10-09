/**
 * 每个 Activity 固定 8 个验收格（树+仓库 v3.0）：promise / nfr / judgment / invariants / failure / readback / adversarial / shelf_life。
 * 迁移 521 给存量补过；新建 Activity 的两个入口（合同同步插入、沉淀技能候选）都要在建行当下补齐，否则新 Activity 永远没有颜色可看。
 */
import { describe, it, expect, vi } from 'vitest';
import { CELL_KEYS, ensureEightCells } from '../activity-cells.js';

describe('ensureEightCells', () => {
  it('8 个标准格各一条幂等插入（冲突不覆盖已有颜色）', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    await ensureEightCells(db, 'act-1', 'journey-1');
    expect(db.query).toHaveBeenCalledTimes(8);
    expect(db.query.mock.calls.map(([, params]) => params[2])).toEqual([...CELL_KEYS]);
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).toMatch(/INSERT INTO activity_cells \(journey_id, step_id, cell_kind, cell_key\)/);
      expect(sql).toMatch(/ON CONFLICT \(step_id, cell_kind, cell_key\) WHERE cell_kind IS NOT NULL DO NOTHING/);
      expect(params.slice(0, 2)).toEqual(['journey-1', 'act-1']);
    }
  });

  it('8 个键与迁移 521 的标准键一致', () => {
    expect([...CELL_KEYS]).toEqual(['promise', 'nfr', 'judgment', 'invariants', 'failure', 'readback', 'adversarial', 'shelf_life']);
  });
});
