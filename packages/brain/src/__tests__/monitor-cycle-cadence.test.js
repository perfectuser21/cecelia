/** 默认PR：真实监控公开入口重复完成周期；禁止真实DB、资源采样、外联和处置。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({
  forbidden: vi.fn(() => { throw Error('monitor_cadence_external_effect_forbidden'); }),
  query: vi.fn(),
  active: vi.fn(() => 3),
  snapshots: [],
}));
vi.mock('../db.js', () => ({ default: { query: effects.query } }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: effects.active, MAX_SEATS: 10 }));
vi.mock('../actions.js', () => ({ updateTask: effects.forbidden }));
vi.mock('../lib/task-terminal.js', () => ({ finalizeTask: effects.forbidden }));
vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: effects.forbidden, cacheRcaResult: effects.forbidden,
  getRcaCacheStats: effects.forbidden,
}));
vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: effects.forbidden, dispatchToDevSkill: effects.forbidden,
  getAutoFixStats: effects.forbidden,
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: effects.forbidden }));

let monitor;
let cpu;
let memory;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
  vi.stubGlobal('fetch', effects.forbidden);
  vi.spyOn(process, 'kill').mockImplementation(effects.forbidden);
  memory = vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: 128 * 1024 ** 2, heapTotal: 64 * 1024 ** 2, heapUsed: 32 * 1024 ** 2,
    external: 0, arrayBuffers: 0,
  });
  cpu = vi.spyOn(process, 'cpuUsage').mockReturnValue({ user: 0, system: 0 });
  effects.snapshots.length = 0;
  effects.query.mockImplementation(async sql => {
    if (typeof sql !== 'string') return effects.forbidden(sql);
    if (sql.includes('FROM run_events r')) return { rows: [] };
    if (sql.includes('COUNT(*) FILTER')) {
      return { rows: [{ failed_count: '0', total_count: '0', failure_rate: '0.00' }] };
    }
    if (sql.includes("VALUES ('resource_snapshot'")) return { rows: [] };
    return effects.forbidden(sql);
  });
  // 记录真实SQL边界收到的快照封套；不自行重写业务算法或假装实际持久化。
  const reply = effects.query.getMockImplementation();
  effects.query.mockImplementation(async (sql, args) => {
    const result = await reply(sql, args);
    if (sql.includes("VALUES ('resource_snapshot'")) effects.snapshots.push(JSON.parse(args[0]));
    return result;
  });
  vi.resetModules();
  monitor = await import('../monitor-loop.js');
});
afterEach(() => {
  try {
    expect(effects.forbidden).not.toHaveBeenCalled();
  } finally {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it('立即完成一次后，每30秒继续完成真实检测和资源快照，不能退化为单次定时器', async () => {
  monitor.startMonitorLoop();
  let previousCompleted = null;
  for (const [index, elapsed] of [100, 30000, 30000].entries()) {
    await vi.advanceTimersByTimeAsync(elapsed);
    const expected = index + 1;
    const status = monitor.getMonitorStatus();
    expect(status.running).toBe(true);
    expect(status.monitoring).toBe(false);
    expect(status.interval_ms).toBe(30000);
    expect(status.cycle_count).toBe(expected);
    expect(status.last_cycle_at).toBeGreaterThan(previousCompleted ?? 0);
    previousCompleted = status.last_cycle_at;
    expect(effects.snapshots).toHaveLength(expected);
    expect(effects.active).toHaveBeenCalledTimes(expected);
    expect(memory).toHaveBeenCalledTimes(expected);
    expect(cpu).toHaveBeenCalledTimes(expected * 2);
    expect(effects.query).toHaveBeenCalledTimes(expected * 3);
    expect(effects.snapshots.at(-1)).toEqual({
      cpu_percent: 0, rss_mb: 128, active_processes: 3, max_seats: 10, utilization: 0.3,
    });
  }
});
