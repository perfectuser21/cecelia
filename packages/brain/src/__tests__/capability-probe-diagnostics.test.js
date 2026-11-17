import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn().mockResolvedValue('unexpected-task') }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('child_process', () => ({ spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '', stderr: '' }) }));
vi.mock('fs', () => ({ existsSync: vi.fn().mockReturnValue(true) }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('探针周期只记录诊断', () => {
  it.each([[5, 1], [1, 3]])('%i 个失败、%i 次历史仍不造单或回滚', async (failureCount, historyCount) => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
    const { PROBES, runProbeCycle, getProbeResults } = await import('../capability-probe.js');
    const pool = (await import('../db.js')).default;
    const { createTask } = await import('../actions.js');
    const { spawnSync } = await import('child_process');
    const { raise } = await import('../alerting.js');
    const batches = Array.from({ length: historyCount }, () => ({ payload: { probes: [{ name: 'controlled-0', ok: false }] } }));
    const persisted = [];
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes("VALUES ('capability_probe'")) persisted.push(JSON.parse(params[0]));
      return { rows: sql.includes('SELECT') ? batches : [] };
    });
    const original = PROBES.slice();
    PROBES.splice(0, PROBES.length, ...Array.from({ length: failureCount }, (_, i) => ({ name: `controlled-${i}`, description: '隔离故障', fn: async () => {
      if (i === 0) throw new Error('controlled failure');
      return { ok: false, detail: 'diagnostic failure' };
    } })));
    try {
      const results = await runProbeCycle();
      expect(results).toHaveLength(failureCount);
      expect(results.every(result => result.ok === false)).toBe(true);
      expect(results[0].error).toBe('controlled failure');
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({ failed: failureCount, passed: 0, probes: results });
      expect(await getProbeResults(historyCount)).toEqual(batches);
      expect.soft(createTask.mock.calls.length).toBe(0);
      expect.soft(spawnSync.mock.calls.length).toBe(0);
      expect.soft(raise.mock.calls.length).toBe(0);
      expect(pool.query.mock.calls.filter(([sql]) => /INSERT INTO tasks|probe_rollback_triggered/.test(sql))).toEqual([]);
    } finally { PROBES.splice(0, PROBES.length, ...original); }
  });
});

vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn().mockReturnValue(false),
  getConsciousnessStatus: vi.fn().mockReturnValue({ env_override: false }),
  setConsciousnessEnabled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../consciousness-loop.js', () => ({ startConsciousnessLoop: vi.fn() }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue({ digested: 0 }) }));

it('反刍loop_dead保留禁用开关与诊断，不启动意识或模型', async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubEnv('BRAIN_MINIMAL_MODE', 'false');
  const pool = (await import('../db.js')).default;
  pool.query.mockImplementation(async sql => ({ rows: sql.includes("key = 'consciousness_enabled'")
    ? [{ value_json: { enabled: false } }] : [{ cnt: sql.includes('digested = false') ? 1 : 0, last_run: null }] }));
  const { PROBES, runProbeCycle } = await import('../capability-probe.js');
  const original = PROBES.slice();
  const rumination = original.find(probe => probe.name === 'rumination');
  PROBES.splice(0, PROBES.length, rumination);
  try {
    const [result] = await runProbeCycle();
    await new Promise(resolve => queueMicrotask(resolve));
    const { setConsciousnessEnabled } = await import('../consciousness-guard.js');
    const { startConsciousnessLoop } = await import('../consciousness-loop.js');
    const { runRumination } = await import('../rumination.js');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('loop_dead');
    expect(result.detail).toContain('consciousness=DISABLED(db)');
    expect.soft(setConsciousnessEnabled.mock.calls.length).toBe(0);
    expect.soft(startConsciousnessLoop.mock.calls.length).toBe(0);
    expect.soft(runRumination.mock.calls.length).toBe(0);
  } finally { PROBES.splice(0, PROBES.length, ...original); vi.unstubAllEnvs(); }
});
