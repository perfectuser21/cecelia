import { describe, it, expect } from 'vitest';
import { advanceTaskIndexNode } from '../workflows/harness-initiative.graph.js';

describe('advanceTaskIndexNode — serial merge gate', () => {
  it('上一个 sub-task status=failed → 返回 error，不递增 index', async () => {
    const state = {
      task_loop_index: 1,
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
      sub_tasks: [{ id: 'ws1', status: 'merged' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
    expect(result.task_loop_fix_count).toBe(0);
    expect(result.evaluate_verdict).toBeNull();
    expect(result.evaluate_feedback).toBeNull();
  });

  it('sub_tasks 为空（防御性）→ 正常递增，无 error', async () => {
    const state = {
      task_loop_index: 0,
      sub_tasks: [],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
  });
});
