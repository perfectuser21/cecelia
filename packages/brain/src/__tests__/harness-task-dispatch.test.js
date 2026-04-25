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

  // 共享的 no-op DB deps：v6 Phase B 后 dispatcher 在成功分支会调
  // writeDockerCallback + pool.query；这里用 noop 防污染测试日志。
  const noopDbDeps = {
    writeDockerCallback: async () => {},
    pool: { query: async () => ({ rows: [] }) },
  };

  it('passes worktreePath + env.GITHUB_TOKEN to executor', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => {
        captured = opts;
        return { exit_code: 0, stdout: '{"result":"ok"}', stderr: '', timed_out: false };
      },
      ensureWorktree: async ({ taskId }) => `/tmp/wt/harness-v2/task-${String(taskId).slice(0, 8)}`,
      resolveToken: async () => 'ghs_test',
      ...noopDbDeps,
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
      ...noopDbDeps,
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
      ...noopDbDeps,
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
      // v6 Phase B: 注入 no-op 依赖，防止真连 DB
      writeDockerCallback: async () => {},
      pool: { query: vi.fn(async () => ({ rows: [] })) },
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(true);
    expect(res.result).toBeTruthy();
  });

  describe('Harness v6 Phase B: callback + ci_watch chain', () => {
    const prUrlStdout = JSON.stringify({
      type: 'result',
      result: '{"verdict":"DONE","pr_url":"https://github.com/o/r/pull/77"}',
    });

    it('calls writeDockerCallback with container result when exit_code === 0', async () => {
      const writeCb = vi.fn(async () => {});
      const poolMock = { query: vi.fn(async () => ({ rows: [] })) };
      const deps = {
        executor: async () => ({
          exit_code: 0,
          stdout: prUrlStdout,
          stderr: '',
          timed_out: false,
          duration_ms: 1000,
          container: 'cecelia-task-xxx',
          started_at: 's',
          ended_at: 'e',
        }),
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: writeCb,
        pool: poolMock,
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      const res = await triggerHarnessTaskDispatch(baseTask(), deps);
      expect(res.success).toBe(true);
      expect(writeCb).toHaveBeenCalledTimes(1);
      const [cbTask, runId, cpId, cbResult] = writeCb.mock.calls[0];
      expect(cbTask.id).toBe('task-abcdef1234567890');
      expect(cbTask.task_type).toBe('harness_task');
      expect(typeof runId).toBe('string');
      expect(runId.length).toBeGreaterThan(0);
      expect(cpId).toBeNull();
      expect(cbResult.exit_code).toBe(0);
    });

    it('does NOT call writeDockerCallback when exit_code !== 0', async () => {
      const writeCb = vi.fn(async () => {});
      const deps = {
        executor: async () => ({ exit_code: 2, stdout: 'x', stderr: 'bang', timed_out: false }),
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: writeCb,
        pool: { query: vi.fn() },
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      const res = await triggerHarnessTaskDispatch(baseTask(), deps);
      expect(res.success).toBe(false);
      expect(writeCb).not.toHaveBeenCalled();
    });

    it('inserts harness_ci_watch task when stdout contains pr_url', async () => {
      const poolMock = { query: vi.fn(async () => ({ rows: [] })) };
      const deps = {
        executor: async () => ({
          exit_code: 0,
          stdout: prUrlStdout,
          stderr: '',
          timed_out: false,
          duration_ms: 1000,
        }),
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: poolMock,
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch(baseTask(), deps);
      const insertCalls = poolMock.query.mock.calls.filter(
        ([sql]) => /INSERT INTO tasks/i.test(sql) && /harness_ci_watch/.test(sql)
      );
      expect(insertCalls.length).toBe(1);
      const [, params] = insertCalls[0];
      expect(params[0]).toMatch(/CI-Watch/);
      expect(params[1]).toContain('https://github.com/o/r/pull/77');
      const payload = JSON.parse(params[2]);
      expect(payload.pr_url).toBe('https://github.com/o/r/pull/77');
      expect(payload.parent_task_id).toBe('task-abcdef1234567890');
      expect(payload.initiative_id).toBe('initiative-xxx');
      expect(payload.harness_mode).toBe(true);
    });

    it('does NOT insert harness_ci_watch when stdout lacks pr_url', async () => {
      const poolMock = { query: vi.fn(async () => ({ rows: [] })) };
      const deps = {
        executor: async () => ({
          exit_code: 0,
          stdout: 'no url here, just logs',
          stderr: '',
          timed_out: false,
          duration_ms: 1000,
        }),
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: poolMock,
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch(baseTask(), deps);
      const insertCalls = poolMock.query.mock.calls.filter(
        ([sql]) => /harness_ci_watch/.test(sql)
      );
      expect(insertCalls.length).toBe(0);
    });

    it('does NOT insert harness_ci_watch when exit_code !== 0', async () => {
      const poolMock = { query: vi.fn(async () => ({ rows: [] })) };
      const deps = {
        executor: async () => ({
          exit_code: 1,
          stdout: '{"pr_url":"https://github.com/o/r/pull/1"}',
          stderr: '',
          timed_out: false,
        }),
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: poolMock,
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch(baseTask(), deps);
      const insertCalls = poolMock.query.mock.calls.filter(
        ([sql]) => /harness_ci_watch/.test(sql)
      );
      expect(insertCalls.length).toBe(0);
    });
  });
});
