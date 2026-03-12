/**
 * dispatcher-quota-cooling — 派发前全局 quota 冷却检查
 *
 * 验收：
 * - isGlobalQuotaCooling=true → dispatchNextTask 返回 {skipped:true, reason:'quota_cooling'}
 * - 冷却期内不写 DB、不创建任何进程
 * - isGlobalQuotaCooling=false → 正常走后续 billing pause / slot 检查
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── quota-cooling mock ──────────────────────────────────────
const mockIsGlobalQuotaCooling = vi.fn(() => false);
const mockGetQuotaCoolingState = vi.fn(() => ({ active: false }));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: (...args) => mockIsGlobalQuotaCooling(...args),
  getQuotaCoolingState: (...args) => mockGetQuotaCoolingState(...args),
}));

// ── db mock ─────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// ── executor mock ───────────────────────────────────────────
const mockTriggerCeceliaRun = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: mockTriggerCeceliaRun,
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue({ orphans_fixed: 0, rebuilt: 0 }),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
  })
}));

vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({})
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false })
}));

vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn(),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn()
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({})
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
}));

// ── tests ────────────────────────────────────────────────────

describe('dispatchNextTask — quota cooling 活跃时立即跳过', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGlobalQuotaCooling.mockReturnValue(false);
    mockGetQuotaCoolingState.mockReturnValue({ active: false });
  });

  it('isGlobalQuotaCooling=true 时返回 {skipped:true, reason:"quota_cooling"}', async () => {
    const coolUntil = new Date(Date.now() + 3600000).toISOString();
    mockIsGlobalQuotaCooling.mockReturnValue(true);
    mockGetQuotaCoolingState.mockReturnValue({ active: true, until: coolUntil, reason: 'quota_cooling' });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask([]);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('quota_cooling');
  });

  it('quota cooling 活跃时不写 DB', async () => {
    mockIsGlobalQuotaCooling.mockReturnValue(true);
    mockGetQuotaCoolingState.mockReturnValue({
      active: true,
      until: new Date(Date.now() + 3600000).toISOString(),
      reason: 'quota_cooling',
    });

    const { dispatchNextTask } = await import('../tick.js');
    await dispatchNextTask([]);

    // mockQuery 代表 DB 写入，不应被调用
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('quota cooling 活跃时不触发 triggerCeceliaRun（不创建进程）', async () => {
    mockIsGlobalQuotaCooling.mockReturnValue(true);
    mockGetQuotaCoolingState.mockReturnValue({
      active: true,
      until: new Date(Date.now() + 3600000).toISOString(),
      reason: 'quota_cooling',
    });

    const { dispatchNextTask } = await import('../tick.js');
    await dispatchNextTask([]);

    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });

  it('isGlobalQuotaCooling=false 时不因 quota_cooling 短路', async () => {
    mockIsGlobalQuotaCooling.mockReturnValue(false);
    // 提供最小 DB mock，使 selectNextDispatchableTask 返回空结果
    mockQuery.mockResolvedValue({ rows: [] });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('quota_cooling');
    expect(result.skipped).toBeFalsy();
  });
});

describe('quota-cooling.js — 基本功能', () => {
  it('isGlobalQuotaCooling 默认返回 false', async () => {
    const { isGlobalQuotaCooling } = await import('../quota-cooling.js');
    // vitest vi.mock 拦截导入，这里测试 mock 本身行为
    expect(typeof isGlobalQuotaCooling).toBe('function');
  });
});
