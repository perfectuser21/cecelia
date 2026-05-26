import { describe, it, expect } from 'vitest';
import { advanceTaskIndexNode } from '../workflows/harness-initiative.graph.js';

describe('advanceTaskIndexNode — serial merge gate', () => {
  it('上一个 sub-task status=failed → 返回 error，不递增 index', async () => {
    const state = {
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws1' }] },
      sub_tasks: [{ id: 'ws1', status: 'failed' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.message).toContain('ws1');
    expect(result.task_loop_index).toBeUndefined();
  });

  it('上一个 sub-task status=undefined → 返回 error', async () => {
    const state = {
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws2' }] },
      sub_tasks: [{ id: 'ws2', status: undefined }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.message).toContain('ws2');
  });

  it('上一个 sub-task status=timeout → 返回 error', async () => {
    const state = {
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws1' }] },
      sub_tasks: [{ id: 'ws1', status: 'timeout' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.message).toContain('ws1');
  });

  it('上一个 sub-task status=merged → 正常递增 index，无 error', async () => {
    const state = {
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws1' }] },
      sub_tasks: [{ id: 'ws1', status: 'merged' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
    expect(result.task_loop_fix_count).toBe(0);
    expect(result.evaluate_verdict).toBeNull();
    expect(result.evaluate_feedback).toBeNull();
  });

  it('sub_tasks 为空（首次调用防御）→ 正常递增，无 error', async () => {
    const state = {
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws1' }] },
      sub_tasks: [],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
  });

  it('E2E 重跑路径：task_loop_index=0，sub_tasks 含历史记录，ws1 本轮 failed → 返回 error', async () => {
    // final E2E FAIL 后 task_loop_index 重置为 0，sub_tasks 保留上轮历史
    // ws1 重跑后 run_sub_task reducer 更新 ws1 记录为 failed
    const state = {
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws1' }, { id: 'ws2' }] },
      sub_tasks: [
        { id: 'ws1', status: 'failed' },  // 本轮 ws1 重跑后 failed
        { id: 'ws2', status: 'merged' },  // 上轮历史：ws2 曾 merged
      ],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.message).toContain('ws1');
  });
});
