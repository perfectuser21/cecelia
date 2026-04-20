import { describe, it, expect, vi } from 'vitest';

describe('triggerHarnessTaskDispatch', () => {
  function baseTask(overrides = {}) {
    return {
      id: 'task-abcdef1234567890',
      task_type: 'harness_task',
      title: 'impl ws1',
      description: 'write schema file',
      payload: {
        parent_task_id: 'initiative-xxx',
        logical_task_id: 'ws1',
        dod: ['[ARTIFACT] schema.ts exists'],
        files: ['packages/brain/src/schema.ts'],
        fix_mode: false,
      },
      ...overrides,
    };
  }

  it('passes worktreePath + env.GITHUB_TOKEN to executor', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => {
        captured = opts;
        return { exit_code: 0, stdout: '{"result":"ok"}', stderr: '', timed_out: false };
      },
      ensureWorktree: async ({ taskId }) => `/tmp/wt/harness-v2/task-${String(taskId).slice(0, 8)}`,
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured.worktreePath).toContain('harness-v2');
    expect(captured.env.GITHUB_TOKEN).toBe('ghs_test');
    expect(captured.env.CECELIA_TASK_TYPE).toBe('harness_task');
    expect(captured.env.HARNESS_NODE).toBe('generator');
    expect(captured.env.HARNESS_INITIATIVE_ID).toBe('initiative-xxx');
    expect(captured.env.HARNESS_TASK_ID).toBe('task-abcdef1234567890');
  });

  it('maps payload.fix_mode=true to env.HARNESS_FIX_MODE=true', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    await triggerHarnessTaskDispatch(baseTask({ payload: { parent_task_id: 'i', fix_mode: true } }), deps);
    expect(captured.env.HARNESS_FIX_MODE).toBe('true');
  });

  it('maps missing/false fix_mode to env.HARNESS_FIX_MODE=false', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    await triggerHarnessTaskDispatch(baseTask({ payload: { parent_task_id: 'i' } }), deps);
    expect(captured.env.HARNESS_FIX_MODE).toBe('false');
  });

  it('returns {success:false} when token resolver fails, without spawning', async () => {
    const exec = vi.fn();
    const deps = {
      executor: exec,
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => { throw new Error('github_token_unavailable'); },
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/github_token_unavailable/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns {success:false} when worktree creation fails, without spawning', async () => {
    const exec = vi.fn();
    const deps = {
      executor: exec,
      ensureWorktree: async () => { throw new Error('worktree add failed'); },
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/worktree add failed/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns {success:false} when container exit_code != 0', async () => {
    const deps = {
      executor: async () => ({ exit_code: 1, stdout: 'oops', stderr: 'bang', timed_out: false }),
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/exit_code|bang/);
  });

  it('returns {success:true} when container exit_code === 0', async () => {
    const deps = {
      executor: async () => ({ exit_code: 0, stdout: '{"ok":true}', stderr: '', timed_out: false }),
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(true);
    expect(res.result).toBeTruthy();
  });
});
