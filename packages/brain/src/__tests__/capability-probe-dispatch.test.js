import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn((rca) => rca.confidence >= 0.7),
  dispatchToDevSkill: vi.fn().mockResolvedValue('test-task-id'),
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn(),
  sendAlert: vi.fn(),
}));

vi.mock('../cortex.js', () => ({
  performRCA: vi.fn(),
}));

vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn().mockReturnValue({ running: true, interval_ms: 30000, cycle_count: 1, last_cycle_at: Date.now() - 1000 }),
  startMonitorLoop: vi.fn(),
}));

vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn().mockReturnValue(true),
  setConsciousnessEnabled: vi.fn(),
  getConsciousnessStatus: vi.fn().mockReturnValue({ env_override: false }),
}));

// executor.js mock — controlled per test
vi.mock('../executor.js', () => ({
  getActiveProcessCount: vi.fn().mockReturnValue(3),
  MAX_SEATS: 10,
}));

describe('capability-probe dispatch probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatch probe ok=true when executor module is available', async () => {
    const executor = await import('../executor.js');
    executor.getActiveProcessCount.mockReturnValue(3);

    const pool = (await import('../db.js')).default;
    // Provide enough rows for DB + rumination + evolution + consolidation probes
    pool.query.mockResolvedValue({
      rows: [{ task_count: 10, recent_runs: 5, learning_count: 50, cnt: 1, last_run: new Date().toISOString() }],
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();

    const dispatch = results.find(r => r.name === 'dispatch');
    expect(dispatch).toBeDefined();
    expect(dispatch.ok).toBe(true);
    expect(dispatch.detail).toContain('active=3/10');
    expect(dispatch.error).toBeNull();
  });

  it('dispatch probe ok=false when getActiveProcessCount throws — error surfaces in detail field', async () => {
    const executor = await import('../executor.js');
    executor.getActiveProcessCount.mockImplementation(() => {
      throw new Error('executor internal error');
    });

    const pool = (await import('../db.js')).default;
    pool.query.mockResolvedValue({
      rows: [{ task_count: 10, recent_runs: 5, learning_count: 50, cnt: 1, last_run: new Date().toISOString() }],
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();

    const dispatch = results.find(r => r.name === 'dispatch');
    expect(dispatch).toBeDefined();
    expect(dispatch.ok).toBe(false);
    // With internal try-catch: error appears in detail, not in error field
    expect(dispatch.detail).toContain('executor.getActiveProcessCount failed');
    expect(dispatch.error).toBeNull();
  });

  // Regression test: PROBE_FAIL_DISPATCH — executor module not importable
  // Root cause: preview-3941 worktree was based on a branch predating executor.js (introduced in PR #3859).
  // The dispatch probe must return ok=false with detail in the detail field (not the error field),
  // because probeDispatch now handles import failures internally.
  it('REGRESSION: dispatch probe ok=false with detail (not error) when executor subsystem broken', async () => {
    const executor = await import('../executor.js');
    // Simulate the "Cannot find module" scenario by making getActiveProcessCount fail
    // (functionally equivalent: probe reports ok=false, other probes keep running).
    executor.getActiveProcessCount.mockImplementation(() => {
      const err = new Error("Cannot find module '.../executor.js'");
      err.code = 'ERR_MODULE_NOT_FOUND';
      throw err;
    });

    const pool = (await import('../db.js')).default;
    pool.query.mockResolvedValue({
      rows: [{ task_count: 5, recent_runs: 2, learning_count: 20, cnt: 1, last_run: new Date().toISOString() }],
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();

    const dispatch = results.find(r => r.name === 'dispatch');
    expect(dispatch).toBeDefined();
    expect(dispatch.ok).toBe(false);
    // error field must be null — error is captured in detail by the probe itself
    expect(dispatch.error).toBeNull();
    expect(dispatch.detail.length).toBeGreaterThan(0);
    // Must not throw unhandled — other probes should still run
    const dbProbe = results.find(r => r.name === 'db');
    expect(dbProbe).toBeDefined();
    // DB probe should pass with mocked pool
    expect(dbProbe.ok).toBe(true);
  });
});
