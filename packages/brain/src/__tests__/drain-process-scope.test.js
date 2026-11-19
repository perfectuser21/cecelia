import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ tasks: [], persisted: null, read: null, storedRead: null, deletion: null, insertion: null }));
vi.mock('../db.js', () => ({ default: { query: async (sql, params) => {
  if (sql.includes('INSERT INTO working_memory')) {
    if (boundary.insertion) { const hook = boundary.insertion; boundary.insertion = null; await hook(); }
    boundary.persisted = structuredClone(params[1]);
  }
  if (sql.includes('DELETE FROM working_memory')) {
    if (boundary.deletion) { const hook = boundary.deletion; boundary.deletion = null; await hook(); }
    if (params.length < 2 || (boundary.persisted?.drain_id ?? null) === params[1]) boundary.persisted = null;
  }
  if (sql.includes('SELECT value_json FROM working_memory')) {
    const snapshot = structuredClone(boundary.persisted);
    if (boundary.storedRead) { const hook = boundary.storedRead; boundary.storedRead = null; await hook(); }
    return { rows: snapshot ? [{ value_json: snapshot }] : [] };
  }
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
  vi.resetModules(); boundary.tasks = []; boundary.persisted = null; boundary.read = null; boundary.storedRead = null; boundary.deletion = null; boundary.insertion = null;
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

  it('新协议暂停不因15分钟经过而自动解除', async () => {
    await drain.drainTick();
    const at = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(at + 60 * 60 * 1000);
    try {
      expect(drain.isDraining()).toBe(true);
      expect((await drain.getDrainStatus()).safe_to_swap).toBe(true);
      expect(boundary.persisted?.draining).toBe(true);
    } finally { vi.restoreAllMocks(); }
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
  it('精确取消只清当前ID，已取消的重复请求幂等但不伪造历史ID', async () => {
    const first = await drain.drainTick();
    expect(await drain.cancelDrain('wrong-id')).toMatchObject({ success: false });
    expect(drain.isDraining()).toBe(true);
    expect(await drain.cancelDrain(first.drain_id)).toMatchObject({ success: true, drain_id: first.drain_id });
    const repeated = await drain.cancelDrain(first.drain_id);
    expect(repeated).toMatchObject({ success: true, was_draining: false });
    expect(repeated).not.toHaveProperty('drain_id');
  });

  it('控制记录删除串联，不让旧取消越过另一轮控制写入', async () => {
    const first = await drain.drainTick();
    const entered = deferred(), released = deferred();
    boundary.deletion = async () => { entered.resolve(); await released.promise; };
    const staleCancel = drain.cancelDrain(first.drain_id);
    await entered.promise;
    let secondFinished = false;
    const nextCancel = drain.cancelDrain(first.drain_id).then(result => { secondFinished = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    const overtook = secondFinished;
    released.resolve(); await Promise.all([staleCancel, nextCancel]);
    expect(overtook).toBe(false);
    const second = await drain.drainTick();
    expect(drain.isDraining()).toBe(true);
    expect(boundary.persisted.drain_id).toBe(second.drain_id);
    expect((await drain.getDrainStatus()).safe_to_swap).toBe(true);
  });

  it('启动INSERT延迟时取消必须等待该写入，完成后不能残留旧暂停', async () => {
    const entered = deferred(), released = deferred();
    boundary.insertion = async () => { entered.resolve(); await released.promise; };
    const start = drain.drainTick();
    await entered.promise;
    let cancelled = false;
    const cancelling = drain.cancelDrain().then(result => { cancelled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    const cancelledBeforeInsert = cancelled;
    released.resolve(); await Promise.all([start, cancelling]);
    expect(cancelledBeforeInsert).toBe(false);
    expect(boundary.persisted).toBeNull();
    expect(drain.isDraining()).toBe(false);
  });

  it('恢复读取旧记录挂起时，显式取消后旧查询不能复活暂停', async () => {
    await drain.drainTick(); drain._resetDrainState();
    const entered = deferred(), released = deferred();
    boundary.storedRead = async () => { entered.resolve(); await released.promise; };
    const staleRestore = drain.restoreDrainState();
    await entered.promise;
    await drain.cancelDrain();
    released.resolve(); await staleRestore;
    expect(boundary.persisted).toBeNull();
    expect(drain.isDraining()).toBe(false);
  });

  it('控制记录写失败向调用方报错，后续显式取消仍能执行', async () => {
    boundary.insertion = async () => { throw Error('controlled write failure'); };
    await expect(drain.drainTick()).rejects.toThrow('controlled write failure');
    expect(drain.isDraining()).toBe(true);
    expect((await drain.getDrainStatus()).safe_to_swap).toBe(false);
    expect(await drain.cancelDrain()).toMatchObject({ success: true });
    expect(drain.isDraining()).toBe(false);
  });

  it('读旧任务快照期间启动token刚完成接管，也不能漏掉本次在途执行', async () => {
    const token = drain.beginBrainLaunch('local-review');
    await drain.drainTick();
    const entered = deferred(), released = deferred();
    boundary.read = async () => { entered.resolve(); await released.promise; return { rows: [] }; };
    const statusRead = drain.getDrainStatus();
    await entered.promise;
    boundary.tasks = [{ id: 'local-review', executor_kind: 'codex-review-local', status: 'in_progress', payload: {} }];
    drain.finishBrainLaunch(token);
    released.resolve();
    expect((await statusRead).safe_to_swap).toBe(false);
    expect((await drain.getDrainStatus()).blockers).toContainEqual(expect.objectContaining({ task_id: 'local-review', kind: 'local_execution' }));
  });

});
