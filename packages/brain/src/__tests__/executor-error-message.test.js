/** 真实启动孤儿恢复与tick liveness；仅隔离外部IO，不模拟失败处置本身。 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
const io = vi.hoisted(() => ({ query: vi.fn(), execSync: vi.fn(), logs: new Map() }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('child_process', () => ({
  spawn: vi.fn(() => { throw new Error('禁止真实spawn'); }),
  exec: vi.fn(() => { throw new Error('禁止真实exec'); }), execSync: io.execSync,
  execFile: vi.fn((...args) => { const cb = args.at(-1); if (typeof cb === 'function') cb(null, '', ''); }),
}));
vi.mock('fs', async (original) => {
  const actual = await original();
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = resolve(process.cwd(), '../..');
  return { ...actual, existsSync: vi.fn((file) => io.logs.has(String(file))),
    readFileSync: vi.fn((file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
      if (io.logs.has(target)) return io.logs.get(target);
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || /credential|auth\.json/.test(target)) throw new Error('禁止仓外文件或凭据读取');
      return actual.readFileSync(file, ...args);
    }),
  };
});
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));
vi.mock('../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn() }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn() }));
vi.mock('../platform-utils.js', async (original) => ({ ...await original(), getDmesgInfo: vi.fn(() => ''), listProcessesWithPpid: vi.fn(() => []) }));
let executor;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止真实网络'); }));
  executor = await import('../executor.js');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks(); io.query.mockReset(); io.execSync.mockReturnValue('0'); io.logs.clear();
  executor.suspectProcesses.clear();
});
function task(overrides = {}) {
  return { id: 'owned-executor-task', title: 'owned recovery fixture', task_type: 'dev',
    payload: { current_run_id: 'owned-run', watchdog_retry_count: 2 },
    started_at: new Date(Date.now() - 7200000).toISOString(), ...overrides };
}
function database(row) {
  io.query.mockImplementation(async (sql) => {
    if (/SELECT id, title, payload, started_at/.test(sql) || sql.startsWith('SELECT payload, task_type')) return { rows: [row] };
    if (sql.startsWith('SELECT id FROM learnings')) return { rows: [{ id: 'already-recorded' }] };
    return { rows: [], rowCount: 1 };
  });
}
function onlyWrite(pattern) {
  const writes = io.query.mock.calls.filter(([sql]) => pattern.test(sql));
  expect(writes, '真实生产路径必须且只能写一次目标状态').toHaveLength(1);
  return writes[0];
}
describe('真实孤儿/看门狗失败证据', () => {
  it('有run且重试耗尽的孤儿经finalizeTask写failed与error_message', async () => {
    const row = task(); database(row);
    expect(await executor.syncOrphanTasksOnStartup()).toMatchObject({ orphans_found: 1, orphans_fixed: 1, requeued: 0 });
    const [sql, params] = onlyWrite(/UPDATE tasks SET status = 'failed'/);
    expect(params[0]).toBe(row.id);
    expect(sql).toMatch(/error_message\s*=\s*\$2/);
    expect(params[1]).toMatch(/^\[orphan_detected\] reason=process_disappeared at \d{4}-/);
    expect(JSON.parse(params[2]).error_details).toMatchObject({ type: 'orphan_detected', run_id: 'owned-run', reason: 'process_disappeared' });
  });
  it('无run的内联任务只回队，不冒称覆盖孤儿失败', async () => {
    const row = task({ payload: { current_run_id: null } }); database(row);
    expect(await executor.syncOrphanTasksOnStartup()).toMatchObject({ orphans_found: 1, orphans_fixed: 0, requeued: 1 });
    expect(io.query.mock.calls.some(([sql]) => /status = 'failed'/.test(sql))).toBe(false);
    const [sql, params] = onlyWrite(/UPDATE tasks SET\s+status = 'queued'/);
    expect(sql).toContain('error_message = NULL'); expect(params[0]).toBe(row.id);
  });
  it('活进程只重建跟踪，不写失败或回队', async () => {
    const row = task({ id: 'owned-alive-task' }); database(row); io.execSync.mockReturnValue('1');
    expect(await executor.syncOrphanTasksOnStartup()).toMatchObject({ rebuilt: 1, orphans_found: 0, orphans_fixed: 0, requeued: 0 });
    expect(io.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
    executor.removeActiveProcess(row.id);
  });
  it('liveness双确认后由真实requeueTask写诊断与事件，不直接调用mock updater', async () => {
    const row = task({ payload: { current_run_id: 'owned-run', watchdog_retry_count: 0 } }); database(row);
    io.logs.set(`/tmp/cecelia-${row.id}.log`, 'owned fixture: process previously started');
    expect(await executor.probeTaskLiveness()).toEqual([]);
    expect(executor.suspectProcesses.has(row.id)).toBe(true);
    expect(io.query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
    expect(await executor.probeTaskLiveness()).toMatchObject([{ action: 'liveness_auto_requeue', task_id: row.id, requeue_result: { requeued: true, retry_count: 1 } }]);
    const [sql, params] = onlyWrite(/UPDATE tasks SET status = 'queued'/);
    expect(sql).toContain("AND status = 'in_progress'"); expect(params[0]).toBe(row.id);
    expect(JSON.parse(params[1])).toMatchObject({ watchdog_retry_count: 1,
      watchdog_kill: { reason: 'process_disappeared', type: 'liveness_probe_failed', diagnostic_info: { log_tail: 'owned fixture: process previously started' } },
      watchdog_last_sample: { reason: 'process_disappeared', probe_ticks: 2 } });
    const events = io.query.mock.calls.filter(([text, args]) => text.includes('INSERT INTO task_events') && args[1] === 'watchdog_requeue');
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0][1][2])).toMatchObject({ reason: 'liveness_dead', exit_reason: 'process_disappeared', retry_count: 1 });
    expect(executor.suspectProcesses.has(row.id)).toBe(false);
  });
  it('liveness活进程清除suspect，不写任务或失败事件', async () => {
    const row = task(); database(row); io.execSync.mockReturnValue('1');
    executor.suspectProcesses.set(row.id, { firstSeen: new Date().toISOString(), tickCount: 1 });
    expect(await executor.probeTaskLiveness()).toEqual([]);
    expect(executor.suspectProcesses.has(row.id)).toBe(false);
    expect(io.query.mock.calls.some(([sql]) => /UPDATE tasks|INSERT INTO task_events/.test(sql))).toBe(false);
  });
  it('有资源证据的watchdog超限才写quarantine错误', async () => {
    const row = task({ payload: { watchdog_retry_count: 1, failure_count: 1 } }); database(row);
    expect(await executor.requeueTask(row.id, 'RSS exceeded', { rss_mb: 3000 })).toMatchObject({ quarantined: true });
    const [sql, params] = onlyWrite(/UPDATE tasks SET status = 'quarantined'/);
    expect(sql).toMatch(/error_message\s*=\s*\$2/); expect(params[0]).toBe(row.id);
    expect(params[1]).toMatch(/^\[watchdog\] reason=RSS exceeded at \d{4}-/);
  });
});
