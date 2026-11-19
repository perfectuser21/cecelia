import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ prepare: vi.fn(), activity: null, persisted: null, query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: (...args) => io.query(...args) } }));
vi.mock('../runtime-safety.js', async original => ({ ...await original(), assertExternalExecutionAllowed: () => {} }));
vi.mock('../invocations/runtime.js', () => ({
  invocationBridgeRequired: task => Boolean(task.payload?.invocation),
  prepareInvocationDispatch: (...args) => io.prepare(...args),
  runInvocationActivities: () => io.activity.promise,
  invocationTaskPrompt: () => null,
  reconcileInvocationLiveness: async () => null,
}));
vi.mock('../invocations/activity-worker.js', () => ({ createInvocationActivityExecutor: () => async () => ({}) }));
vi.mock('../execution-directory/legacy-executor.js', async original => ({
  ...await original(), legacyExecutorEntries: () => [{ executor: 'codex', url: 'http://fixed-bridge.invalid' }],
}));
vi.mock('../lib/task-run.js', async original => ({ ...await original(),
  startRunForExecResult: async ({ execResult }) => execResult?.runId ?? null,
  finishRun: async () => ({}),
}));
vi.mock('../lib/internal-service-auth.js', async original => ({ ...await original(), internalServiceHeaders: headers => headers }));
vi.mock('fs', async original => {
  const actual = await original();
  return { ...actual, readFileSync: (file, ...args) => {
    if (/auth\.json|credentials|\.env/.test(String(file))) throw Object.assign(Error('fixture forbids credentials'), { code: 'ENOENT' });
    return actual.readFileSync(file, ...args);
  } };
});
vi.mock('child_process', async original => ({ ...await original(), execSync: vi.fn(() => ''), spawn: vi.fn() }));

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const task = { id: '9ef3aadb-36e9-4665-9187-4b51a59ba3f1', task_type: 'research', payload: { invocation: { dispatch: {} } } };
const runId = 'd5a50a38-15ba-4211-bd8c-796869dbdc16';
let executor, drain;
beforeEach(async () => {
  vi.resetModules(); io.persisted = null; io.activity = deferred(); io.prepare.mockReset().mockResolvedValue({ runId });
  io.query.mockReset().mockImplementation(async (sql, params) => {
    if (sql.includes('INSERT INTO working_memory')) io.persisted = structuredClone(params[1]);
    if (sql.includes('DELETE FROM working_memory')) io.persisted = null;
    return { rows: [], rowCount: 1 };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, status: 'healthy', accounts: [{ tokenExpired: false, primaryUsedPct: 0 }] }) })));
  executor = await import('../executor.js'); drain = await import('../drain.js');
});
afterEach(async () => {
  io.activity.resolve({ receipt: { fixture: true } });
  await new Promise(resolve => setImmediate(resolve));
  await drain.cancelDrain();
  vi.unstubAllGlobals();
});

describe('真实执行入口的发布排空边界', () => {
  it('已经排空时，实际触发漏斗拒绝新执行且不会预留运行', async () => {
    await drain.drainTick();
    const result = await executor.triggerCeceliaRun(task);
    expect(result).toMatchObject({ success: false, reason: 'draining' });
    expect(io.prepare).not.toHaveBeenCalled();
  });

  it('首个异步启动还未完成时，真实触发边界仍阻止切换', async () => {
    const entered = deferred(), prepared = deferred();
    io.prepare.mockImplementation(async () => { entered.resolve(); return prepared.promise; });
    const start = executor.triggerCeceliaRun(task);
    await entered.promise;
    try {
      await drain.drainTick();
      const status = await drain.getDrainStatus();
      expect(status.remaining).toBeGreaterThan(0);
      expect(status.safe_to_swap).toBe(false);
    } finally {
      prepared.resolve({ runId });
      await start;
    }
  });

  it('共享Controller没有PID，资源计数不能抹去正在运行的真实Promise', async () => {
    const result = await executor.triggerCeceliaRun(task);
    expect(result.success).toBe(true);
    expect(executor.getActiveProcesses().map(entry => entry.taskId)).toContain(task.id);
    executor.getActiveProcessCount();
    expect(executor.getActiveProcesses().map(entry => entry.taskId)).toContain(task.id);
    await drain.drainTick();
    const status = await drain.getDrainStatus();
    expect(status.remaining).toBeGreaterThan(0);
    expect(status.safe_to_swap).toBe(false);
  });
});
