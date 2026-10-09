/** grids.test.js — OpenClaw 八格常量配对测试(lint-test-pairing) */
import { describe, it, expect } from 'vitest';
import { OPENCLAW_LEADGEN_GRIDS } from '../grids.js';

describe('OPENCLAW_LEADGEN_GRIDS', () => {
  it('恰好八格且无重复(第一批被告封闭清单)', () => {
    expect(OPENCLAW_LEADGEN_GRIDS).toHaveLength(8);
    expect(new Set(OPENCLAW_LEADGEN_GRIDS).size).toBe(8);
  });
  it('全部为非空字符串键(可作 grid_key 落库)', () => {
    for (const g of OPENCLAW_LEADGEN_GRIDS) {
      expect(typeof g).toBe('string');
      expect(g.length).toBeGreaterThan(0);
    }
  });
});
