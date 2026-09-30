/**
 * Initiative Closer - Project 完成触发审查测试（已退役，决策 ee4842a6/3feeae3e，
 * 接力棒链 2afa6d69 棒4）
 *
 * 原逻辑：Project 下所有 Scope/Initiative 完成 → checkProjectCompletion 关闭 Project →
 * 触发 shouldAdjustPlan 渐进验证。scope/initiative 层退役（migration 499 写保护）后，
 * 这条链的判定依据（okr_scopes/okr_initiatives 是否全部完成）永远拿不到数据，
 * checkProjectCompletion 已清空为 no-op——回归守卫改为：恒返回零变化，且从不查询
 * 数据库、从不触发 shouldAdjustPlan/createPlanAdjustmentTask。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock progress-reviewer.js（验证 no-op 后这两个函数确实不再被调）
vi.mock('../progress-reviewer.js', () => ({
  reviewProjectCompletion: vi.fn(async () => ({ found: true })),
  shouldAdjustPlan: vi.fn(async () => null),
  createPlanAdjustmentTask: vi.fn(async () => ({ task: { id: 'task-1' }, review: { id: 'review-1' } })),
}));

import { checkProjectCompletion } from '../initiative-closer.js';
import { shouldAdjustPlan, createPlanAdjustmentTask } from '../progress-reviewer.js';

function makeSpyPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('checkProjectCompletion（已退役，no-op）', () => {
  let pool;

  beforeEach(() => {
    pool = makeSpyPool();
    vi.clearAllMocks();
  });

  it('恒返回零变化，且从不查询数据库、从不触发渐进验证', async () => {
    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(shouldAdjustPlan).not.toHaveBeenCalled();
    expect(createPlanAdjustmentTask).not.toHaveBeenCalled();
  });
});
