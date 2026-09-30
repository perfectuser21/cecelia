/**
 * OKR Closer 单元测试（层已退役，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）
 *
 * okr_initiatives / okr_scopes / okr_projects 停写停读，okr-closer.js 的
 * checkOkrInitiativeCompletion / checkOkrScopeCompletion / checkOkrProjectCompletion
 * 三个函数已清空为 no-op。回归守卫：三个函数无论传入什么 pool，都绝不调用
 * pool.query——对应验收标准"tick 一轮无 okr_scopes/okr_initiatives 查询"。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  checkOkrInitiativeCompletion,
  checkOkrScopeCompletion,
  checkOkrProjectCompletion,
} from '../okr-closer.js';

function makeSpyPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

describe('okr-closer（已退役，no-op）', () => {
  let pool;
  beforeEach(() => {
    pool = makeSpyPool();
  });

  describe('checkOkrInitiativeCompletion', () => {
    it('恒返回零变化，且从不查询数据库', async () => {
      const result = await checkOkrInitiativeCompletion(pool);
      expect(result).toEqual({ closedCount: 0, closed: [] });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('checkOkrScopeCompletion', () => {
    it('恒返回零变化，且从不查询数据库', async () => {
      const result = await checkOkrScopeCompletion(pool);
      expect(result).toEqual({ closedCount: 0, closed: [] });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('checkOkrProjectCompletion', () => {
    it('恒返回零变化，且从不查询数据库', async () => {
      const result = await checkOkrProjectCompletion(pool);
      expect(result).toEqual({ closedCount: 0, closed: [] });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
