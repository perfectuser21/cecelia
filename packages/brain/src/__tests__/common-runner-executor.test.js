import { describe, expect, it, vi } from 'vitest';
import { runCommonRunnerTasks } from '../common-runner-executor.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const task = () => ({ id: uuid(1), status: 'queued', kind: 'agent', payload: {
  common_runner: { run_id: uuid(2), profile: 'demo', mode: 'exploration', input: {} },
}, result: {}, claimed_by: null });
function poolFor(rows) {
  return { query: vi.fn(async (sql, params) => {
    if (sql.startsWith('SELECT')) {
      let selected = rows.filter(t => sql.includes("status='in_progress'") ? t.status === 'in_progress' : t.status === 'queued');
      if (sql.includes('LIMIT 10')) selected = selected.sort((a, b) => {
        const afterA = !params?.[0] || a.id > params[0], afterB = !params?.[0] || b.id > params[0];
        return afterA === afterB ? a.id.localeCompare(b.id) : afterA ? -1 : 1;
      }).slice(0, 10);
      return { rows: selected, rowCount: selected.length };
    }
    if (sql.includes('SET claimed_by')) {
      const t = rows.find(t => t.id === params[0]);
      if (!t || (t.claimed_by && t.claimed_by !== 'common-runner')) return { rows: [], rowCount: 0 };
      t.claimed_by = 'common-runner'; return { rows: [structuredClone(t)], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }) };
}
describe('Brain common runner automatic completion job', () => {
  it('claims at most one AI task and sends its fixed profile through the HTTP dispatch service', async () => {
    const rows = [task(), { ...task(), id: uuid(3) }], pool = poolFor(rows);
    const dispatch = vi.fn(async () => ({ authenticated: true, receipt: { status: 'running' }, central_run: { status: 'running' } }));
    const result = await runCommonRunnerTasks(pool, { dispatcher: { dispatch } });
    expect(result.dispatched).toBe(1); expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('start', uuid(2), { task_id: uuid(1), profile: 'demo', mode: 'exploration', input: {} });
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("kind='agent'") && sql.includes('headed_manual'))).toBe(true);
  });
  it('never starts an existing unknown run again; inspects and flushes evidence before task finalization', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner';
    t.result.common_runner = { run_id: uuid(2), task_id: t.id };
    const pool = poolFor([t]);
    const dispatch = vi.fn(async action => action === 'inspect'
      ? { authenticated: true, receipt: { status: 'completed', writeback: { pending: 1 } }, central_run: { status: 'running' } }
      : { authenticated: true, receipt: { status: 'completed' }, central_run: { status: 'success', recording_status: 'confirmed' } });
    const finalize = vi.fn(async () => ({ rowCount: 1 }));
    const result = await runCommonRunnerTasks(pool, { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(dispatch.mock.calls.map(c => c[0])).toEqual(['inspect', 'flush']);
    expect(finalize).toHaveBeenCalledWith(pool, t.id, 'completed', expect.objectContaining({ onlyIfStatus: 'in_progress', mergeResult: expect.objectContaining({ actor: 'common-runner', evidence: expect.any(Array) }) }));
    expect(result.reaped).toBe(1);
  });
  it('keeps execution ownership when no signed terminal or central evidence confirmation exists', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner'; t.result.common_runner = { run_id: uuid(2), task_id: t.id };
    const dispatch = vi.fn(async () => ({ status: 'unknown', next_action: 'inspect' })), finalize = vi.fn();
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(dispatch.mock.calls.map(c => c[0])).toEqual(['inspect']); expect(finalize).not.toHaveBeenCalled();
  });
  it('does not dispatch a human-owned or headed opt-in task even if returned by a stale scan', async () => {
    const t = task(); t.payload.headed_manual = true;
    const dispatch = vi.fn();
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch } });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('round-robin reaping reaches the eleventh run despite ten earlier offline runs', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ ...task(), id: uuid(i + 1), status: 'in_progress', claimed_by: 'common-runner',
      result: { common_runner: { run_id: uuid(i + 101), task_id: uuid(i + 1) } } }));
    const pool = poolFor(rows), finalize = vi.fn(async () => ({ rowCount: 1 }));
    const dispatch = vi.fn(async (_action, runId) => runId === uuid(111)
      ? { authenticated: true, receipt: { status: 'completed' }, central_run: { status: 'success', recording_status: 'confirmed' } }
      : { status: 'unknown', next_action: 'inspect' });
    await runCommonRunnerTasks(pool, { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(finalize).not.toHaveBeenCalled();
    await runCommonRunnerTasks(pool, { dispatcher: { dispatch }, finalizeTask: finalize });
    expect(finalize).toHaveBeenCalledWith(pool, uuid(11), 'completed', expect.anything());
    expect(dispatch).toHaveBeenCalledTimes(20);
  });
  it('signed not-started wait resumes with its frozen profile/input and the same run', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner';
    t.result.common_runner = { run_id: uuid(2), task_id: t.id, launch_state: 'not_started', profile: 'demo', mode: 'exploration', input: { fixed: true } };
    const dispatch = vi.fn(async () => ({ authenticated: true, receipt: { status: 'running' }, central_run: { status: 'running' } }));
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch } });
    expect(dispatch).toHaveBeenCalledWith('start', uuid(2), { task_id: t.id, profile: 'demo', mode: 'exploration', input: { fixed: true } });
  });
  it('a cancelled not-started wait is only cancelled or inspected, never restarted', async () => {
    const t = task(); t.status = 'in_progress'; t.claimed_by = 'common-runner';
    t.result.common_runner = { run_id: uuid(2), task_id: t.id, launch_state: 'not_started', cancel_requested: true, profile: 'demo', mode: 'exploration', input: {} };
    const dispatch = vi.fn(async () => ({ status: 'unknown', next_action: 'inspect' }));
    await runCommonRunnerTasks(poolFor([t]), { dispatcher: { dispatch } });
    expect(dispatch).toHaveBeenCalledWith('cancel', uuid(2), { task_id: t.id });
  });
});
