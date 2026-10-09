/**
 * Initiative Closer 单元测试（层已退役，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * okr_initiatives / okr_scopes / okr_projects 停写停读，initiative-closer.js 的
 * checkInitiativeCompletion / checkScopeCompletion / checkProjectCompletion /
 * activateNextInitiatives 四个函数已清空为 no-op。回归守卫：这四个函数无论传入
 * 什么 pool，都绝不调用 pool.query——这是防止 scope/initiative 拆解逻辑"复活"
 * 偷偷再跑一次查询的关键断言（对应验收标准"tick 一轮无 okr_scopes/okr_initiatives
 * 查询"）。
 *
 * getMaxActiveInitiatives / MAX_ACTIVE_INITIATIVES 与 scope/initiative 拆解无关
 * （纯 worker slot 容量公式），覆盖不变。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn((slots) => {
    const s = Math.max(1, Math.floor(slots ?? 9));
    return {
      slots: s,
      project: { max: Math.min(2, Math.ceil(s / 2)), softMin: 1, cooldownMs: 180000 },
      initiative: { max: s, softMin: Math.ceil(s / 3), cooldownMs: 120000 },
      task: { queuedCap: s * 3, softMin: s, cooldownMs: 60000 },
    };
  }),
}));

import {
  checkInitiativeCompletion,
  checkScopeCompletion,
  checkProjectCompletion,
  activateNextInitiatives,
  getMaxActiveInitiatives,
  MAX_ACTIVE_INITIATIVES,
} from '../initiative-closer.js';

function makeSpyPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

describe('initiative-closer（已退役，no-op）', () => {
  let pool;
  beforeEach(() => {
    pool = makeSpyPool();
  });

  describe('checkInitiativeCompletion', () => {
    it('恒返回零变化，且从不查询数据库', async () => {
      const result = await checkInitiativeCompletion(pool);
      expect(result).toEqual({ closedCount: 0, closed: [], activatedCount: 0 });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('checkScopeCompletion', () => {
    it('恒返回零变化，且从不查询数据库', async () => {
      const result = await checkScopeCompletion(pool);
      expect(result).toEqual({ closedCount: 0, closed: [] });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('checkProjectCompletion', () => {
    it('恒返回零变化，且从不查询数据库', async () => {
      const result = await checkProjectCompletion(pool);
      expect(result).toEqual({ closedCount: 0, closed: [] });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('activateNextInitiatives', () => {
    it('恒返回 0，且从不查询数据库', async () => {
      const result = await activateNextInitiatives(pool);
      expect(result).toBe(0);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('传 slotsOverride 也不改变行为（仍 no-op）', async () => {
      const result = await activateNextInitiatives(pool, 20);
      expect(result).toBe(0);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('getMaxActiveInitiatives（与 scope/initiative 拆解无关，不受退役影响）', () => {
    it('返回一个数字', () => {
      expect(typeof getMaxActiveInitiatives(5)).toBe('number');
    });

    it('返回正值', () => {
      expect(getMaxActiveInitiatives(0)).toBeGreaterThan(0);
      expect(getMaxActiveInitiatives(5)).toBeGreaterThan(0);
    });

    it('随 slots 增大而不减小', () => {
      const lowSlots = getMaxActiveInitiatives(1);
      const highSlots = getMaxActiveInitiatives(20);
      expect(highSlots).toBeGreaterThanOrEqual(lowSlots);
    });
  });

  describe('MAX_ACTIVE_INITIATIVES', () => {
    it('是正数常量，当前值为 9', () => {
      expect(typeof MAX_ACTIVE_INITIATIVES).toBe('number');
      expect(MAX_ACTIVE_INITIATIVES).toBe(9);
    });
  });
});
