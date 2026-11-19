import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ tasks: [], persisted: null, read: null }));
vi.mock('../db.js', () => ({ default: { query: async (sql, params) => {
  if (sql.includes('INSERT INTO working_memory')) boundary.persisted = structuredClone(params[1]);
  if (sql.includes('DELETE FROM working_memory')) boundary.persisted = null;
  if (sql.includes('SELECT value_json FROM working_memory')) return { rows: boundary.persisted ? [{ value_json: boundary.persisted }] : [] };
  if (sql.includes('FROM tasks')) {
    if (boundary.read) { const read = boundary.read; boundary.read = null; return read(); }
    return { rows: structuredClone(boundary.tasks) };
  }
  return { rows: [] };
} } }));
vi.mock('../executor.js', () => ({ getActiveProcesses: () => [] }));

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let drain;
beforeEach(async () => {
  vi.resetModules(); boundary.tasks = []; boundary.persisted = null; boundary.read = null;
  drain = await import('../drain.js');
});

describe('发布排空只等待受 Brain 进程切换影响的执行', () => {
  it('外部执行记录仍保持进行中，排空已经就绪而且暂停保持', async () => {
    boundary.tasks = ['headed-session', 'coding-workflow-runner', 'external-worker', 'openclaw-agent', 'script'].map((executor_kind, i) => ({
      id: `external-${i}`, title: '独立执行', executor_kind, status: 'in_progress', claimed_by: 'external-owner',
      started_at: '2000-01-01T00:00:00Z', payload: {},
    }));
    const before = structuredClone(boundary.tasks);
    await drain.drainTick();
    const status = await drain.getDrainStatus();
    expect(status.remaining).toBe(0);
    expect(status.safe_to_swap).toBe(true);
    expect(status.independent_task_count).toBe(5);
    expect(drain.isDraining()).toBe(true);
    expect(boundary.tasks).toEqual(before);
  });

  it('本机旧执行和未知归属不会因为记录陈旧而放行', async () => {
    boundary.tasks = [
      { id: 'local-old', executor_kind: 'brain-local', status: 'in_progress', started_at: '2000-01-01', payload: {} },
      { id: 'unknown-old', executor_kind: null, status: 'in_progress', started_at: '2000-01-01', payload: {} },
    ];
    await drain.drainTick();
    const status = await drain.getDrainStatus();
    expect(status.remaining).toBe(2);
    expect(status.safe_to_swap).toBe(false);
    expect(status.blockers.map(x => x.task_id).sort()).toEqual(['local-old', 'unknown-old']);
  });

  it('没有任务时读零仍保持持久暂停，取消之后才恢复', async () => {
    await drain.drainTick();
    const ready = await drain.getDrainStatus();
    expect(drain.isDraining()).toBe(true);
    expect(boundary.persisted?.draining).toBe(true);
    expect(ready).toMatchObject({ protocol: 'brain-process-drain-v1', draining: true, safe_to_swap: true, remaining: 0 });
    await drain.cancelDrain();
    expect(drain.isDraining()).toBe(false);
    expect(boundary.persisted).toBeNull();
    expect((await drain.getDrainStatus()).safe_to_swap).toBe(false);
  });

  it('并发取消再开启时，旧数据库查询不能授予新一轮切换许可', async () => {
    const first = await drain.drainTick();
    const readEntered = deferred(), readFinished = deferred();
    boundary.read = async () => { readEntered.resolve(); await readFinished.promise; return { rows: [] }; };
    const staleRead = drain.getDrainStatus();
    await readEntered.promise;
    await drain.cancelDrain();
    const second = await drain.drainTick();
    readFinished.resolve();
    const status = await staleRead;
    expect(status.safe_to_swap).toBe(false);
    expect(first.drain_id).toEqual(expect.any(String));
    expect(second.drain_id).not.toBe(first.drain_id);
    expect(drain.isDraining()).toBe(true);
  });
});
