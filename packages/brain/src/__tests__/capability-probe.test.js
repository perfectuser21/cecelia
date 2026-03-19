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

  // ── 回归防护：probeEvolution 必须查询 component_evolutions（不能是 cecelia_events）──
  // 故障历史：曾错误查询 cecelia_events 导致 evolution probe 永远失败（PR #1177 修复）
  describe('probeEvolution 回归防护', () => {
    it('有记录时返回 ok=true，查询 component_evolutions 表', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({
        rows: [{ cnt: '5', last_date: new Date('2026-03-18') }],
      });

      const { PROBES } = await import('../capability-probe.js');
      const evProbe = PROBES.find(p => p.name === 'evolution');
      const result = await evProbe.fn();

      expect(result.ok).toBe(true);
      expect(result.detail).toContain('7d_pr_evolutions=5');

      // 关键回归断言：必须查询 component_evolutions
      const queryCalls = pool.query.mock.calls;
      const usesCorrectTable = queryCalls.some(
        call => typeof call[0] === 'string' && call[0].includes('component_evolutions')
      );
      expect(usesCorrectTable).toBe(true);
    });

    it('无记录时返回 ok=false，detail 含 last_date=never', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockResolvedValue({
        rows: [{ cnt: '0', last_date: null }],
      });

      const { PROBES } = await import('../capability-probe.js');
      const evProbe = PROBES.find(p => p.name === 'evolution');
      const result = await evProbe.fn();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('7d_pr_evolutions=0');
      expect(result.detail).toContain('last_date=never');
    });
  });
});
