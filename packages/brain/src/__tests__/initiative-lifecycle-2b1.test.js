/**
 * PR 2b-1 回归测试：okr_initiatives 生命周期状态机（已退役，决策 ee4842a6/3feeae3e，
 * 接力棒链 2afa6d69 棒4）
 *
 * 原测试锁定 planned/running/done 生命周期词汇在 SQL 里的正确用法。
 * okr_initiatives 层随 GTD 四级模型退役而冻结（migration 499 写保护），
 * activateNextInitiatives / checkInitiativeCompletion / checkOkrInitiativeCompletion
 * 已清空为 no-op——不再有任何 SQL 发往 okr_initiatives，生命周期词汇语义已无意义。
 * 回归守卫改为：三个函数无论传入什么 pool，都绝不调用 pool.query。
 */

import { describe, it, expect, vi } from 'vitest';
import { activateNextInitiatives, checkInitiativeCompletion } from '../initiative-closer.js';
import { checkOkrInitiativeCompletion } from '../okr-closer.js';

function makeSpyPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

describe('2b-1（已退役）: activateNextInitiatives', () => {
  it('恒返回 0，且从不查询/更新 okr_initiatives', async () => {
    const pool = makeSpyPool();
    const activated = await activateNextInitiatives(pool);
    expect(activated).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('2b-1（已退役）: checkInitiativeCompletion', () => {
  it('恒返回零变化，且从不查询/更新 okr_initiatives', async () => {
    const pool = makeSpyPool();
    const result = await checkInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('2b-1（已退役）: checkOkrInitiativeCompletion', () => {
  it('恒返回零变化，且从不查询/更新 okr_initiatives', async () => {
    const pool = makeSpyPool();
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
