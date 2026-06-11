/**
 * Resume 终局误判修复：harness initiative serial gate（advanceTaskIndexNode）。
 *
 * 根因：在飞 run 期间另一 PR merge 触发部署重启 → startup-sync re-queue + dispatcher resume，
 * 恢复图走到 serial gate 时 sub_task 状态仍是 checkpoint 旧值（queued/未 merged），
 * 旧逻辑直接判 terminal FAIL → 误杀可恢复的在飞 run（实证 d8acba51 / c0e2546b）。
 *
 * 修复：判 FAIL 前必须从持久事实源（GitHub PR 状态）重导出 sub-task 真实状态——
 *   - PR 已 merged → 视为完成，纠正状态并放行推进；
 *   - status=queued 无终败证据 → 不判 FAIL，重新进入 run_sub_task 复用既有幂等链路；
 *   - genuine 终败（status=failed）或重跑超上限 → 保持 terminal FAIL。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { advanceTaskIndexNode, stateHasError } from '../harness-initiative.graph.js';

const baseState = (overrides = {}) => ({
  task: { id: 'init-id', title: 't', payload: {} },
  initiativeId: 'init-id',
  taskPlan: { tasks: [{ id: 'ws1', task_id: 'ws1' }, { id: 'ws2', task_id: 'ws2' }] },
  task_loop_index: 0,
  task_loop_fix_count: 0,
  ...overrides,
});

describe('advanceTaskIndexNode — resume 终局误判防护', () => {
  it('PR 实际已 merged（checkpoint status=queued 陈旧）→ 走 merged 短路，纠正状态并推进，绝不 FAIL', async () => {
    const checkPrMerged = vi.fn().mockResolvedValue(true);
    const state = baseState({
      sub_tasks: [{ id: 'ws1', status: 'queued', pr_url: 'https://github.com/o/r/pull/1' }],
    });
    const result = await advanceTaskIndexNode(state, { _checkPrMerged: checkPrMerged });

    expect(checkPrMerged).toHaveBeenCalledWith('https://github.com/o/r/pull/1');
    expect(result.error).toBeUndefined();
    expect(stateHasError(result)).toBe('ok');
    // 推进到下一个 sub-task
    expect(result.task_loop_index).toBe(1);
    // 纠正 sub_tasks 状态为 merged（reducer merge-by-id）
    expect(result.sub_tasks).toEqual([
      expect.objectContaining({ id: 'ws1', status: 'merged' }),
    ]);
  });

  it('status=queued + PR 未 merged 但仍在飞 → 不判 FAIL，重新进入 run_sub_task（不递增 index）', async () => {
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = baseState({
      sub_tasks: [{ id: 'ws1', status: 'queued', pr_url: 'https://github.com/o/r/pull/1' }],
    });
    const result = await advanceTaskIndexNode(state, { _checkPrMerged: checkPrMerged });

    expect(result.error).toBeUndefined();
    expect(stateHasError(result)).toBe('ok');
    // 不递增 task_loop_index → pick_sub_task 重选同一 sub-task → run_sub_task 重跑
    expect(result.task_loop_index).toBeUndefined();
    expect(result.serial_gate_requeue_count).toBe(1);
  });

  it('status=queued + 无 pr_url（重启截断在 PR 创建前）→ 不判 FAIL，重跑当前 sub-task', async () => {
    const checkPrMerged = vi.fn();
    const state = baseState({
      sub_tasks: [{ id: 'ws1', status: 'queued' }],
    });
    const result = await advanceTaskIndexNode(state, { _checkPrMerged: checkPrMerged });

    expect(checkPrMerged).not.toHaveBeenCalled(); // 无 pr_url 不查
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBeUndefined();
    expect(result.serial_gate_requeue_count).toBe(1);
  });

  it('genuine 终败（status=failed）→ 保持 terminal FAIL（原语义不变）', async () => {
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = baseState({
      sub_tasks: [{ id: 'ws1', status: 'failed' }],
    });
    const result = await advanceTaskIndexNode(state, { _checkPrMerged: checkPrMerged });

    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.terminal).toBe(true);
    expect(stateHasError(result)).toBe('error');
  });

  it('requeue 超上限仍 status=queued 未收敛 → terminal FAIL（防本修复自身死循环）', async () => {
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = baseState({
      sub_tasks: [{ id: 'ws1', status: 'queued' }],
      serial_gate_requeue_count: 2, // 已达 SERIAL_GATE_REQUEUE_CAP
    });
    const result = await advanceTaskIndexNode(state, { _checkPrMerged: checkPrMerged });

    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(stateHasError(result)).toBe('error');
  });

  it('正常路径：status=merged → 推进且 requeue 计数清零', async () => {
    const state = baseState({
      sub_tasks: [{ id: 'ws1', status: 'merged' }],
    });
    const result = await advanceTaskIndexNode(state);

    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
    expect(result.serial_gate_requeue_count).toBe(0);
  });
});
