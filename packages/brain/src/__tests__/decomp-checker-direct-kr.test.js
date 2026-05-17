/**
 * decomp-checker-direct-kr.test.js
 *
 * [已更新] initiative_plan 自动创建逻辑已从 checkReadyKRInitiatives 中删除。
 * 此测试验证直连 kr_id 的 Initiative 仍被正确扫描（KR 状态流转），
 * 但不再创建 initiative_plan 任务。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('../capacity.js', () => ({
  computeCapacity: () => ({ project: { max: 2 }, initiative: { max: 9 }, task: { queuedCap: 27 } }),
  isAtCapacity: () => false,
}));

vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: () => ({ valid: true, reasons: [] }),
}));

describe('checkReadyKRInitiatives — 直连 kr_id Initiative', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  it('直连 kr_id（无 parent_id）的 Initiative 不再自动创建 initiative_plan 任务', async () => {
    const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

    // 1. 查 ready/in_progress KR
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'kr-4', title: 'KR4: 自我迭代能力', status: 'in_progress' }]
    });

    // 2. 查该 KR 下的 active Initiative（直连 kr_id）
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'init-direct-001', name: '优化 KR4 任务派发策略', status: 'active', active_tasks: '0', running_tasks: '0' }]
    });

    const actions = await checkReadyKRInitiatives();

    // initiative_plan 创建逻辑已删除，不应有 create_initiative_plan action
    expect(actions.filter(a => a.action === 'create_initiative_plan')).toHaveLength(0);
  });

  it('直连 kr_id 的 Initiative 已有活跃 task 时正常跳过', async () => {
    const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'kr-4', title: 'KR4', status: 'in_progress' }]
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'init-direct-003', name: '有任务的 Initiative', status: 'active', active_tasks: '1', running_tasks: '1' }]
    });

    const actions = await checkReadyKRInitiatives();

    expect(actions.filter(a => a.action === 'create_initiative_plan')).toHaveLength(0);
  });
});
