/**
 * executor-billing-pause-persist 单元测试
 *
 * 验证 setBillingPause 在设置 in-memory 状态的同时，
 * 异步写入 cecelia_events (billing_pause_set)。
 *
 * P1: pool 有效时写入 billing_pause_set 到 cecelia_events
 * P2: poolRef 为 null 时只设 in-memory，不报错
 * P3: pool.query 失败时打 warn 日志，不阻塞（fire-and-forget）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 所有 executor.js 依赖 ─────────────────────────────

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue({ rows: [] }),
  getEventCounts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(),
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 0, levelName: 'CALM' }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1),
  ALERTNESS_LEVELS: { ALERT: 3 },
  LEVEL_NAMES: {},
}));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../alertness/healing.js', () => ({
  getRecoveryStatus: vi.fn().mockReturnValue({ isRecovering: false }),
}));
vi.mock('../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn().mockReturnValue(8000),
  getMacOSMemoryPressure: vi.fn().mockResolvedValue(0),
  listProcessesWithPpid: vi.fn().mockResolvedValue([]),
  calculatePhysicalCapacity: vi.fn().mockReturnValue(4),
  listProcessesWithElapsed: vi.fn().mockReturnValue([]),
  countClaudeProcesses: vi.fn().mockReturnValue(0),
  getBrainRssMB: vi.fn(() => 500),
  evaluateMemoryHealth: vi.fn(() => ({
    brain_memory_ok: true, system_memory_ok: true, action: 'proceed',
    reason: 'mock', brain_rss_mb: 500, system_available_mb: 8000,
    system_threshold_mb: 600, brain_rss_danger_mb: 1500, brain_rss_warn_mb: 1000,
  })),
  IS_DARWIN: false,
  IS_LINUX: true,
  SYSTEM_RESERVED_MB: 5000,
  MAX_PHYSICAL_CAP: 8,
}));
vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn().mockResolvedValue({ accountId: 'account1', model: 'sonnet' }),
  selectBestAccountForHaiku: vi.fn().mockResolvedValue('account1'),
  getAccountUsage: vi.fn().mockResolvedValue({}),
  markSpendingCap: vi.fn(),
  isSpendingCapped: vi.fn().mockReturnValue(false),
  isAllAccountsSpendingCapped: vi.fn().mockReturnValue(false),
  getSpendingCapStatus: vi.fn().mockReturnValue([]),
  loadSpendingCapsFromDB: vi.fn().mockResolvedValue(undefined),
}));

// ── 导入被测函数 ──────────────────────────────────────────
let setBillingPause, getBillingPause, clearBillingPause;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  const mod = await import('../executor.js');
  setBillingPause = mod.setBillingPause;
  getBillingPause = mod.getBillingPause;
  clearBillingPause = mod.clearBillingPause;
});

// ── 测试 ─────────────────────────────────────────────────

describe('setBillingPause — cecelia_events 持久化', () => {
  it('P1: pool 有效时应写入 billing_pause_set 到 cecelia_events', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const resetTime = new Date(Date.now() + 3600000).toISOString();

    setBillingPause(resetTime, 'quota_exhausted', mockPool);

    // fire-and-forget：等待微任务队列
    await new Promise(resolve => setTimeout(resolve, 10));

    // recordSessionEnd 和 billing_pause_set 都会调用 pool.query
    const calls = mockPool.query.mock.calls;
    const billingCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('billing_pause_set')
    );
    expect(billingCall).toBeDefined();

    // 验证 payload 结构
    const payload = JSON.parse(billingCall[1][0]);
    expect(payload.reset_at).toBe(resetTime);
    expect(payload.reason).toBe('quota_exhausted');
    expect(payload.set_at).toBeDefined();
  });

  it('P2: poolRef 为 null 时只设 in-memory，不报错', () => {
    const resetTime = new Date(Date.now() + 3600000).toISOString();

    // 不传 poolRef，不应报错
    expect(() => setBillingPause(resetTime, 'billing_cap', null)).not.toThrow();

    // in-memory 状态应已设置
    const status = getBillingPause();
    expect(status.active).toBe(true);
    expect(status.resetTime).toBe(resetTime);
    expect(status.reason).toBe('billing_cap');
  });

  it('P3: pool.query 失败时打 warn 日志，不抛错', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    };
    const resetTime = new Date(Date.now() + 3600000).toISOString();

    // 不应抛出
    expect(() => setBillingPause(resetTime, 'billing_cap', mockPool)).not.toThrow();

    // 等待 fire-and-forget 的 catch 执行
    await new Promise(resolve => setTimeout(resolve, 10));

    // 应有 warn 日志包含失败信息
    const warnCalls = warnSpy.mock.calls.flat().join(' ');
    expect(warnCalls).toContain('billing_pause_set');

    warnSpy.mockRestore();
  });

  it('P4: setBillingPause 后 getBillingPause 返回 active=true 含正确字段', () => {
    const resetTime = new Date(Date.now() + 3600000).toISOString();
    setBillingPause(resetTime, 'quota_exhausted', null);

    const status = getBillingPause();
    expect(status.active).toBe(true);
    expect(status.resetTime).toBe(resetTime);
    expect(status.reason).toBe('quota_exhausted');
    expect(status.setAt).toBeDefined();
  });
});
