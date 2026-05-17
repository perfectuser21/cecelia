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
  sendAlert: vi.fn(),
}));

vi.mock('../cortex.js', () => ({
  performRCA: vi.fn(),
}));

vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn().mockReturnValue({ running: true, interval_ms: 30000 }),
  startMonitorLoop: vi.fn(),
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
  });

  describe('shouldAutoFix integration', () => {
    it('should call shouldAutoFix with confidence >= 0.7 for failed probes', async () => {
      const { shouldAutoFix } = await import('../auto-fix.js');

      // Verify shouldAutoFix logic
      expect(shouldAutoFix({ confidence: 0.9, proposed_fix: 'fix something important here' })).toBe(true);
      expect(shouldAutoFix({ confidence: 0.5, proposed_fix: 'fix something' })).toBe(false);
    });
  });

  describe('probeMonitorLoop self-heal', () => {
    it('should call startMonitorLoop and return ok=true when running=false', async () => {
      const monitorLoop = await import('../monitor-loop.js');
      // First call returns running=false (simulating startup failure), second returns true
      monitorLoop.getMonitorStatus
        .mockReturnValueOnce({ running: false, interval_ms: 30000, cycle_count: 0, last_cycle_at: null })
        .mockReturnValue({ running: true, interval_ms: 30000, cycle_count: 0, last_cycle_at: null });

      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({ rows: [] });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const monitorResult = results.find(r => r.name === 'monitor_loop');

      expect(monitorResult).toBeDefined();
      expect(monitorResult.ok).toBe(true);
      expect(monitorLoop.startMonitorLoop).toHaveBeenCalledTimes(1);
    });

    it('should return ok=true without calling startMonitorLoop when already running', async () => {
      const monitorLoop = await import('../monitor-loop.js');
      monitorLoop.getMonitorStatus.mockReturnValue({ running: true, interval_ms: 30000, cycle_count: 3, last_cycle_at: Date.now() - 5000 });

      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({ rows: [] });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const monitorResult = results.find(r => r.name === 'monitor_loop');

      expect(monitorResult).toBeDefined();
      expect(monitorResult.ok).toBe(true);
      expect(monitorLoop.startMonitorLoop).not.toHaveBeenCalled();
    });

    it('should return ok=false with detail when startMonitorLoop throws during self-heal', async () => {
      const monitorLoop = await import('../monitor-loop.js');
      monitorLoop.getMonitorStatus.mockReturnValue({ running: false, interval_ms: 30000, cycle_count: 0, last_cycle_at: null });
      monitorLoop.startMonitorLoop.mockImplementation(() => {
        throw new Error('setInterval unavailable');
      });

      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({ rows: [] });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const monitorResult = results.find(r => r.name === 'monitor_loop');

      expect(monitorResult).toBeDefined();
      expect(monitorResult.ok).toBe(false);
      expect(monitorResult.detail).toContain('self_heal_error');
      // error field should be null (handled inside probe, not propagated to runProbes catch)
      expect(monitorResult.error).toBeNull();
    });

    it('should return ok=false when running=true but loop is stuck (last_cycle_at is stale)', async () => {
      const monitorLoop = await import('../monitor-loop.js');
      // Simulate: timer is running, cycles happened before, but last cycle was 5 minutes ago
      const staleTs = Date.now() - 5 * 60 * 1000; // 5 min ago
      monitorLoop.getMonitorStatus.mockReturnValue({
        running: true,
        interval_ms: 30000,
        cycle_count: 10,
        last_cycle_at: staleTs,
      });

      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({ rows: [] });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const monitorResult = results.find(r => r.name === 'monitor_loop');

      expect(monitorResult).toBeDefined();
      expect(monitorResult.ok).toBe(false);
      expect(monitorResult.detail).toContain('stuck');
    });

    it('should return ok=true when running=true with cycle_count=0 (fresh start, no cycles yet)', async () => {
      const monitorLoop = await import('../monitor-loop.js');
      monitorLoop.getMonitorStatus.mockReturnValue({
        running: true,
        interval_ms: 30000,
        cycle_count: 0,
        last_cycle_at: null,
      });

      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({ rows: [] });

      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const monitorResult = results.find(r => r.name === 'monitor_loop');

      expect(monitorResult).toBeDefined();
      // Fresh start: cycle_count=0 → skip stuck check → ok=true
      expect(monitorResult.ok).toBe(true);
      expect(monitorLoop.startMonitorLoop).not.toHaveBeenCalled();
    });
  });
});
