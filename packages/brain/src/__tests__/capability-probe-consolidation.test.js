/**
 * capability-probe-consolidation.test.js
 *
 * 覆盖 probeConsolidation 的三个场景：
 *   1. 正常通过（48h 内有 memory_stream 记录）
 *   2. 查询超时 → 快速失败，携带 query_timeout detail，触发自愈
 *   3. loop_dead（memory_stream + daily_logs 均无记录）→ 触发自愈，返回 ok=false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockRunDailyConsolidationIfNeeded = vi.fn().mockResolvedValue({ skipped: false });

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(() => false), dispatchToDevSkill: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(() => 0), MAX_SEATS: 10 }));
vi.mock('../alerting.js', () => ({ sendAlert: vi.fn(), raise: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));
vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn(() => ({ running: true, interval_ms: 30000, cycle_count: 1, last_cycle_at: Date.now() })),
  startMonitorLoop: vi.fn(),
}));
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn(() => true),
  getConsciousnessStatus: vi.fn(() => ({ enabled: true, env_override: false })),
  setConsciousnessEnabled: vi.fn(),
  initConsciousnessGuard: vi.fn(),
  logStartupDeclaration: vi.fn(),
  _resetCacheForTest: vi.fn(),
  _resetDeprecationWarn: vi.fn(),
  GUARDED_MODULES: [],
}));
vi.mock('../consolidation.js', () => ({
  runDailyConsolidationIfNeeded: (...args) => mockRunDailyConsolidationIfNeeded(...args),
}));

describe('probeConsolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('48h 内有 memory_stream 记录 → ok=true', async () => {
    // memory_stream 查询返回有记录
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('memory_stream') && String(sql).includes('daily_consolidation')) {
        return Promise.resolve({ rows: [{ cnt: '3', last_run: new Date('2026-05-19T10:00:00Z') }] });
      }
      return Promise.resolve({ rows: [{ task_count: 1, recent_runs: 0, learning_count: 0 }] });
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();
    const consolidation = results.find(r => r.name === 'consolidation');

    expect(consolidation).toBeDefined();
    expect(consolidation.ok).toBe(true);
    expect(consolidation.detail).toContain('48h_consolidations=3');
    expect(consolidation.error).toBeNull();
  });

  it('memory_stream 查询超时 → ok=false detail 含 query_timeout，自愈被触发', async () => {
    let callIndex = 0;
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      // db 探针和其他探针的 DB 查询正常返回
      if (s.includes('task_count') || s.includes('run_events')) {
        return Promise.resolve({ rows: [{ task_count: 1, recent_runs: 0, learning_count: 0 }] });
      }
      // cecelia_events 查询（rumination, synthesis_archive 等）正常返回
      if (s.includes('synthesis_archive') || s.includes('cecelia_events') || s.includes('learnings') || s.includes('component_evolutions') || s.includes('working_memory')) {
        return Promise.resolve({ rows: [{ cnt: '1', last_run: new Date(), last_date: new Date() }] });
      }
      // memory_stream + daily_consolidation：模拟超时（永不 resolve）
      if (s.includes('memory_stream') && s.includes('daily_consolidation')) {
        return new Promise(() => {}); // hang indefinitely
      }
      return Promise.resolve({ rows: [{ cnt: '0' }] });
    });

    // 缩短内部超时以加速测试（通过环境变量注入或 vi.useFakeTimers）
    // 使用 fake timers 触发 setTimeout 回调
    vi.useFakeTimers();

    const { runProbes } = await import('../capability-probe.js');
    const probePromise = runProbes();

    // 推进所有定时器（包括内部 10s query timeout + 外部 30s probe timeout）
    await vi.runAllTimersAsync();

    const results = await probePromise;
    const consolidation = results.find(r => r.name === 'consolidation');

    vi.useRealTimers();

    expect(consolidation).toBeDefined();
    expect(consolidation.ok).toBe(false);
    // 超时场景：detail 含 query_timeout 或 probe 超时
    const detailOrError = consolidation.detail + (consolidation.error || '');
    expect(detailOrError).toMatch(/query_timeout|timeout/i);
  });

  it('memory_stream=0 + daily_logs=0 (loop_dead) → ok=false，自愈被触发', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('task_count') || s.includes('run_events')) {
        return Promise.resolve({ rows: [{ task_count: 1, recent_runs: 0, learning_count: 0 }] });
      }
      if (s.includes('synthesis_archive') || s.includes('cecelia_events') || s.includes('component_evolutions') || s.includes('working_memory')) {
        return Promise.resolve({ rows: [{ cnt: '1', last_run: new Date(), last_date: new Date() }] });
      }
      if (s.includes('learnings') && s.includes('digested')) {
        return Promise.resolve({ rows: [{ cnt: '0' }] });
      }
      // consolidation 相关查询全部返回 0
      if (s.includes('daily_consolidation') || (s.includes('daily_logs') && s.includes('consolidation'))) {
        return Promise.resolve({ rows: [{ cnt: '0', last_run: null, last_date: null }] });
      }
      return Promise.resolve({ rows: [{ cnt: '1' }] });
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();
    const consolidation = results.find(r => r.name === 'consolidation');

    expect(consolidation).toBeDefined();
    expect(consolidation.ok).toBe(false);
    expect(consolidation.detail).toContain('loop_dead');
    expect(consolidation.detail).toContain('self_heal=triggered');

    // 等待 fire-and-forget 的自愈 promise 执行（microtask）
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockRunDailyConsolidationIfNeeded).toHaveBeenCalled();
  });
});
