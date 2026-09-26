/**
 * [BEHAVIOR] finishRun 成功补终态后单点发 run.finished（棒3a 判定入口，任务 33aa2bc4）。
 * 五条执行路径（dispatcher/executor/openclaw/回执/kernel）都经 finishRun，这里一处 emit 覆盖全部。
 * pool 与 emit 都注入 mock，不碰 DB、不 import event-bus。
 */
import { describe, it, expect, vi } from 'vitest';
import { finishRun } from '../task-run.js';

function poolReturning(rows) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('finishRun → run.finished', () => {
  it('UPDATE 命中 1 行 → emit 一次，payload 带 runId/taskId/status/result（RETURNING 回来的合并 result）', async () => {
    const result = { exit_code: 0, artifacts: [], stage: 'preflight', probes: [{ key: 'p1', observed: 3 }] };
    const pool = poolReturning([{ id: 'x', task_id: 't-1', status: 'success', result }]);
    const emit = vi.fn().mockResolvedValue(undefined);
    const out = await finishRun({ runId: 'run-1', status: 'completed', exitCode: 0 }, { pool, emit });
    expect(out).toEqual({ updated: true });
    expect(pool.query.mock.calls[0][0]).toMatch(/RETURNING id, task_id, status, result/);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('run.finished', 'task-run', {
      runId: 'run-1', taskId: 't-1', status: 'success', result,
    });
  });

  it('已终态（UPDATE 0 行）→ 不发事件', async () => {
    const pool = poolReturning([]);
    const emit = vi.fn();
    const out = await finishRun({ runId: 'run-1', status: 'failed', error: 'x' }, { pool, emit });
    expect(out).toEqual({ updated: false });
    expect(emit).not.toHaveBeenCalled();
  });

  it('status=running → 不 UPDATE 不发事件', async () => {
    const pool = poolReturning([]);
    const emit = vi.fn();
    await finishRun({ runId: 'run-1', status: 'running' }, { pool, emit });
    expect(pool.query).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emit 抛错 → fail-open，仍返回 updated:true', async () => {
    const pool = poolReturning([{ id: 'x', task_id: 't-1', status: 'failed', result: {} }]);
    const emit = vi.fn().mockRejectedValue(new Error('bus down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await finishRun({ runId: 'run-1', status: 'failed', error: 'e' }, { pool, emit });
    expect(out).toEqual({ updated: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('run.finished emit failed'));
    warn.mockRestore();
  });
});
