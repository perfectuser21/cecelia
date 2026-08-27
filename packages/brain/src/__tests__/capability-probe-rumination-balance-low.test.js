/**
 * 回归测试：PROBE_FAIL_RUMINATION 388次连失败 RCA
 *
 * 根因：Anthropic API 余额耗尽时，rumination LLM 调用全失败，
 * probe 进入 degraded_llm_failure 分支返回 ok: false，
 * 触发 /dev auto-fix 任务（账单问题代码无法修复），造成无效任务堆积。
 *
 * 修复：degraded_llm_failure + anthropic_balance_low: true → ok: true
 * （降级警告，非代码 bug，不触发 auto-fix）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 外部依赖 ──────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn().mockReturnValue(true),
  setConsciousnessEnabled: vi.fn().mockResolvedValue(undefined),
  getConsciousnessStatus: vi.fn().mockReturnValue({ env_override: false }),
}));

vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn().mockReturnValue(false),
  dispatchToDevSkill: vi.fn().mockResolvedValue('mock-task-id'),
}));

vi.mock('../executor.js', () => ({
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  MAX_SEATS: 10,
}));

vi.mock('../cortex.js', () => ({
  performRCA: vi.fn(),
}));

vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn().mockReturnValue({ running: true, interval_ms: 30000, cycle_count: 1, last_cycle_at: Date.now() }),
  startMonitorLoop: vi.fn(),
}));

vi.mock('child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('fs', () => ({ existsSync: vi.fn().mockReturnValue(true) }));

// ── 辅助：按调用顺序返回 query 结果 ──────────────────────────
// probeRumination 实际执行的 query 顺序（共 7 条，无 72h 查询）：
//   1. synthesis_archive 48h count
//   2. synthesis_archive global max (last_run)
//   3. learnings undigested count
//   4. cecelia_events rumination_output 24h (recentRuns)
//   5. cecelia_events rumination_run 24h (heartbeats)
//   6. cecelia_events rumination_invoke 24h (invocations)
//   7. cecelia_events rumination_llm_failure last (for degraded_llm_failure)
function setupDegradedBalanceLow({ balanceLow = true } = {}) {
  mockQuery
    // 1. 48h synthesis count = 0 → 进入阶段 2
    .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
    // 2. global max last_run
    .mockResolvedValueOnce({ rows: [{ last_run: new Date('2026-07-01').toISOString() }] })
    // 3. undigested learnings > 0 → 进入阶段 3
    .mockResolvedValueOnce({ rows: [{ cnt: '5' }] })
    // 4. rumination_output 24h = 0 → recentRuns = 0
    .mockResolvedValueOnce({ rows: [{ cnt: '0', last_event: null }] })
    // 5. rumination_run heartbeats 24h > 0 → degraded_llm_failure
    .mockResolvedValueOnce({ rows: [{ cnt: '3' }] })
    // 6. rumination_invoke 24h
    .mockResolvedValueOnce({ rows: [{ cnt: '3' }] })
    // 7. last rumination_llm_failure event
    .mockResolvedValueOnce({
      rows: [{
        payload: {
          anthropic_balance_low: balanceLow,
          llm_error: balanceLow
            ? 'anthropic_api_balance_low: Your credit balance is too low'
            : 'Some other LLM error',
          notebook_error: '?',
          batch_size: 2,
        },
      }],
    });
}

// ── Tests ──────────────────────────────────────────────────────

describe('probeRumination — degraded_llm_failure + anthropic_balance_low', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('API 余额耗尽时（anthropic_balance_low=true）probe 返回 ok: true，不触发 auto-fix', async () => {
    setupDegradedBalanceLow({ balanceLow: true });

    const { PROBES } = await import('../capability-probe.js');
    const ruminationProbe = PROBES.find(p => p.name === 'rumination');
    expect(ruminationProbe).toBeDefined();

    const result = await ruminationProbe.fn();

    // 关键断言：账单问题不应视为代码 bug，必须返回 ok: true
    expect(result.ok).toBe(true);
    // detail 中必须包含 api_balance_low 标识，运维可观测
    expect(result.detail).toContain('api_balance_low');
  });

  it('其他 LLM 失败（非余额问题）仍返回 ok: false，正常触发 auto-fix', async () => {
    setupDegradedBalanceLow({ balanceLow: false });

    const { PROBES } = await import('../capability-probe.js');
    const ruminationProbe = PROBES.find(p => p.name === 'rumination');

    const result = await ruminationProbe.fn();

    // 非账单问题的 LLM 失败仍是代码级 bug，probe 应返回 ok: false
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('degraded_llm_failure');
  });
});
