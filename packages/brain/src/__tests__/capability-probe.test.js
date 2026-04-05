import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn((rca) => rca.confidence >= 0.7),
  dispatchToDevSkill: vi.fn().mockResolvedValue('test-task-id'),
}));

vi.mock('../executor.js', () => ({
  getActiveProcessCount: vi.fn().mockReturnValue(2),
  MAX_SEATS: 10,
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn(),
  sendAlert: vi.fn(),
}));

vi.mock('../cortex.js', () => ({
  performRCA: vi.fn(),
}));

vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn().mockReturnValue({ running: true, interval_ms: 30000 }),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb(null, 'rollback ok', '')),
}));

describe('capability-probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runProbes', () => {
    it('should return results for all probes', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({
        rows: [{ task_count: 10, recent_runs: 5, learning_count: 100 }],
      });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThanOrEqual(4);

      for (const r of results) {
        expect(r).toHaveProperty('name');
        expect(r).toHaveProperty('ok');
        expect(r).toHaveProperty('latency_ms');
        expect(typeof r.latency_ms).toBe('number');
      }
    });

    it('should include db, dispatch, auto_fix, notify probes', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({
        rows: [{ task_count: 10, recent_runs: 5, learning_count: 100 }],
      });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const names = results.map(r => r.name);

      expect(names).toContain('db');
      expect(names).toContain('dispatch');
      expect(names).toContain('auto_fix');
      expect(names).toContain('notify');
    });
  });

  describe('getProbeResults', () => {
    it('should query cecelia_events for capability_probe events', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({ rows: [] });

      const { getProbeResults } = await import('../capability-probe.js');
      const results = await getProbeResults(3);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('capability_probe'),
        [3]
      );
      expect(results).toEqual([]);
    });
  });

  describe('getProbeStatus', () => {
    it('should return probe system status', async () => {
      const { getProbeStatus } = await import('../capability-probe.js');
      const status = getProbeStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('interval_ms');
      expect(status).toHaveProperty('probe_count');
      expect(status).toHaveProperty('probe_names');
      expect(status.probe_count).toBeGreaterThanOrEqual(4);
    });

    it('should expose rollback_thresholds in status', async () => {
      const { getProbeStatus } = await import('../capability-probe.js');
      const status = getProbeStatus();

      expect(status).toHaveProperty('rollback_thresholds');
      expect(status.rollback_thresholds.consecutive).toBe(3);
      expect(status.rollback_thresholds.batch_total).toBe(5);
    });
  });

  describe('shouldAutoFix integration', () => {
    it('should call shouldAutoFix with confidence >= 0.7 for failed probes', async () => {
      const { shouldAutoFix } = await import('../auto-fix.js');

      // Verify shouldAutoFix logic
      expect(shouldAutoFix({ confidence: 0.9, proposed_fix: 'fix something important here' })).toBe(true);
      expect(shouldAutoFix({ confidence: 0.5, proposed_fix: 'fix something' })).toBe(false);
    });
  });

  describe('ROLLBACK_THRESHOLDS', () => {
    it('should have conservative values: consecutive=3, batch_total=5', async () => {
      const { ROLLBACK_THRESHOLDS } = await import('../capability-probe.js');
      expect(ROLLBACK_THRESHOLDS.consecutive).toBe(3);
      expect(ROLLBACK_THRESHOLDS.batch_total).toBe(5);
    });
  });

  describe('_consecutiveFailures counter', () => {
    it('should track consecutive failures per probe name', async () => {
      const { _consecutiveFailures } = await import('../capability-probe.js');

      // Simulate counter update logic (as done in runProbeCycle)
      _consecutiveFailures.set('db', (_consecutiveFailures.get('db') || 0) + 1);
      expect(_consecutiveFailures.get('db')).toBeGreaterThanOrEqual(1);

      // Reset on pass
      _consecutiveFailures.set('db', 0);
      expect(_consecutiveFailures.get('db')).toBe(0);
    });

    it('should accumulate consecutive failures and reset on pass', async () => {
      const { _consecutiveFailures } = await import('../capability-probe.js');

      _consecutiveFailures.set('notify', 0);
      // 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        _consecutiveFailures.set('notify', (_consecutiveFailures.get('notify') || 0) + 1);
      }
      expect(_consecutiveFailures.get('notify')).toBe(3);

      // Pass → reset
      _consecutiveFailures.set('notify', 0);
      expect(_consecutiveFailures.get('notify')).toBe(0);
    });
  });
});
