/**
 * decomp-checker-direct-kr.test.js
 *
 * 测试 checkReadyKRInitiatives 对直连 kr_id（无父 project）Initiative 的扫描。
 *
 * 场景：Initiative 的 kr_id 直接指向 KR，没有 parent_id（扁平结构）。
 * 修复前：INNER JOIN parent 导致这类 Initiative 被排除。
 * 修复后：LEFT JOIN + OR p.kr_id = $1 确保被扫描到。
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

  it('直连 kr_id（无 parent_id）的 Initiative 应被扫描并创建 initiative_plan 任务', async () => {
    const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

    // 1. 查 ready/in_progress KR
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'kr-4', title: 'KR4: 自我迭代能力', status: 'in_progress' }]
    });

    // 2. 查该 KR 下的 active Initiative（直连 kr_id）
    //    返回 dab60c16 类型：有 kr_id 但 active_tasks=0
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'init-direct-001', name: '优化 KR4 任务派发策略', status: 'active', active_tasks: '0', running_tasks: '0' }]
    });

    // 3. hasExistingInitiativePlanTask → 无已有任务（允许创建）
    pool.query.mockResolvedValueOnce({ rows: [] });

    // 4. createInitiativePlanTask INSERT
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-plan-001', title: 'Initiative 规划: 优化 KR4 任务派发策略' }]
    });

    const actions = await checkReadyKRInitiatives();

    expect(actions).toContainEqual(expect.objectContaining({
      action: 'create_initiative_plan',
      kr_id: 'kr-4',
      initiative_id: 'init-direct-001',
    }));
  });

  it('直连 kr_id 的 Initiative 已有 initiative_plan 任务时应去重跳过', async () => {
    const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

    // 1. 查 ready/in_progress KR
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'kr-4', title: 'KR4', status: 'in_progress' }]
    });

    // 2. 查 Initiative（active_tasks=0）
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'init-direct-002', name: '测试 Initiative', status: 'active', active_tasks: '0', running_tasks: '0' }]
    });

    // 3. hasExistingInitiativePlanTask → 已有任务（触发去重）
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-plan-task' }] });

    const actions = await checkReadyKRInitiatives();

    expect(actions).toContainEqual(expect.objectContaining({
      action: 'skip_initiative_plan_dedup',
      initiative_id: 'init-direct-002',
    }));
  });

  it('直连 kr_id 的 Initiative 已有活跃 task 时不创建 initiative_plan', async () => {
    const { checkReadyKRInitiatives } = await import('../decomposition-checker.js');

    // 1. 查 ready/in_progress KR
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'kr-4', title: 'KR4', status: 'in_progress' }]
    });

    // 2. 查 Initiative（active_tasks=1，已有任务）
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'init-direct-003', name: '有任务的 Initiative', status: 'active', active_tasks: '1', running_tasks: '1' }]
    });

    // 不应该查 hasExistingInitiativePlanTask

    const actions = await checkReadyKRInitiatives();

    // 没有 create_initiative_plan 动作
    expect(actions.filter(a => a.action === 'create_initiative_plan')).toHaveLength(0);
  });
});
