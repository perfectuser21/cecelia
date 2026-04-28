import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(() => false), dispatchToDevSkill: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(() => 0), MAX_SEATS: 10 }));
vi.mock('../alerting.js', () => ({ sendAlert: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));
vi.mock('../monitor-loop.js', () => ({ getMonitorStatus: vi.fn(() => ({ running: true, interval_ms: 30000 })) }));

describe('capability-probe high-level probes', () => {
  it('should include rumination, evolution, consolidation, self_drive_health probes', async () => {
    const { PROBES } = await import('../capability-probe.js');
    const names = PROBES.map(p => p.name);
    expect(names).toContain('rumination');
    expect(names).toContain('evolution');
    expect(names).toContain('consolidation');
    expect(names).toContain('self_drive_health');
  });

  it('should have at least 10 probes total', async () => {
    const { PROBES } = await import('../capability-probe.js');
    expect(PROBES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('self_drive_health probe logic', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('should return ok:true when cycle_complete events exist in 24h', async () => {
    // 有 cycle_complete 事件 → 探针应成功
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '2',
        error_cnt: '1',
        last_success: new Date().toISOString(),
        total_tasks_created: '3',
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    expect(probe).toBeDefined();
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('successful_cycles=2');
    expect(result.detail).toContain('errors=1');
  });

  it('should return ok:true when only no_action events exist (LLM healthy but no tasks needed)', async () => {
    // 只有 no_action 事件（LLM 正常但判断无需行动）→ 探针应成功（不误判为失败）
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '3',
        error_cnt: '0',
        last_success: new Date().toISOString(),
        total_tasks_created: '0',
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('successful_cycles=3');
  });

  it('should return ok:false when all cycles are errors (LLM consistently failing)', async () => {
    // 全部 cycle_error（LLM 调用失败）→ 探针应失败
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '8',
        last_success: null,
        total_tasks_created: '0',
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('successful_cycles=0');
    expect(result.detail).toContain('errors=8');
    expect(result.detail).toContain('last_success=never');
  });

  it('should return ok:false when no self_drive events in 24h', async () => {
    // 24h 内无任何事件 → 探针应失败
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: null,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
  });

  it('should return ok:true when loop_started recently and no cycles yet (brain restart grace)', async () => {
    // Brain 刚重启，loop_started 在 6h 内，尚无 cycle → 宽限期内应通过
    const recentStart = new Date(Date.now() - 30 * 60 * 1000); // 30 分钟前
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: recentStart.toISOString(),
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('awaiting_first_cycle');
  });

  it('should return ok:false when loop_started recently but has cycle errors', async () => {
    // Brain 重启 + LLM 已经失败了 → 不能宽恕
    const recentStart = new Date(Date.now() - 10 * 60 * 1000); // 10 分钟前
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '3',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: recentStart.toISOString(),
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('errors=3');
  });

  it('should return ok:false when loop_started is too old (> 6h)', async () => {
    // loop_started 超过 6h，认为系统已失联
    const staleStart = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7 小时前
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: staleStart.toISOString(),
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('last_success=never');
  });
});
