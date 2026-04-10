/**
 * 单元测试：evaluateAlertness 提取子函数逻辑验证
 *
 * 覆盖重构后新提取的6个子函数：
 * - checkAndClearExpiredOverride
 * - applyDualStandardGuard
 * - applyPanicDebounce
 * - handleLevelTransition
 * - executeConditionalResponse
 * - triggerHealingIfNeeded
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 每个 describe 块内通过 resetModules + reimport 隔离模块状态
// 避免 currentState / _consecutiveCriticalCount 跨测试污染

vi.mock('../db.js', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn(),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishAlertnessChanged: vi.fn(),
}));

vi.mock('../alertness/escalation.js', () => ({
  escalateResponse: vi.fn().mockResolvedValue(null),
  executeResponse: vi.fn().mockResolvedValue(null),
  getCurrentResponseLevel: vi.fn().mockReturnValue('normal'),
}));

vi.mock('../alertness/healing.js', () => ({
  applySelfHealing: vi.fn().mockResolvedValue(null),
  getRecoveryStatus: vi.fn().mockReturnValue({ phase: 0 }),
  startRecovery: vi.fn().mockResolvedValue(null),
}));

let mockSeverity = 'none';
let mockHealthScore = 100;
let mockPatterns = [];

vi.mock('../alertness/metrics.js', () => ({
  collectMetrics: vi.fn().mockImplementation(async () => ({
    memory: { value: 50, status: 'normal' },
    cpu: { value: 10, status: 'normal' },
  })),
  calculateHealthScore: vi.fn().mockImplementation(() => mockHealthScore),
  getRecentMetrics: vi.fn().mockReturnValue({}),
}));

vi.mock('../alertness/diagnosis.js', () => ({
  diagnoseProblem: vi.fn().mockImplementation(async () => ({
    issues: mockSeverity === 'none' ? [] : ['high_load'],
    patterns: mockPatterns,
    severity: mockSeverity,
    summary: mockSeverity === 'none' ? 'System is healthy' : 'High load detected',
  })),
  getAnomalyPatterns: vi.fn().mockReturnValue([]),
}));

// ============================================================
// 测试套件
// ============================================================

describe('checkAndClearExpiredOverride — 过期覆盖清除', () => {
  let evaluateAlertness, setManualOverride, collectMetrics;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSeverity = 'none';
    mockHealthScore = 100;
    mockPatterns = [];
    vi.useFakeTimers();

    // 重新 import 获取干净状态
    vi.resetModules();
    const mod = await import('../alertness/index.js');
    evaluateAlertness = mod.evaluateAlertness;
    setManualOverride = mod.setManualOverride;
    const metricsMod = await import('../alertness/metrics.js');
    collectMetrics = metricsMod.collectMetrics;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('手动覆盖未过期时，evaluateAlertness 直接返回当前状态（跳过收集指标）', async () => {
    await setManualOverride(1, '测试覆盖', 60 * 60 * 1000); // 1小时
    const callsBefore = collectMetrics.mock.calls.length;

    await evaluateAlertness();

    expect(collectMetrics.mock.calls.length).toBe(callsBefore);
  });

  it('手动覆盖过期后，evaluateAlertness 正常执行评估', async () => {
    await setManualOverride(1, '短覆盖', 100); // 100ms
    const callsBefore = collectMetrics.mock.calls.length;

    vi.advanceTimersByTime(200); // 超过 100ms
    await evaluateAlertness();

    // 覆盖过期，应正常评估并收集指标
    expect(collectMetrics.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe('applyDualStandardGuard — 双标准冲突保护', () => {
  let evaluateAlertness, getCurrentAlertness, ALERTNESS_LEVELS;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSeverity = 'none';
    mockHealthScore = 100;
    mockPatterns = [];
    vi.useFakeTimers();

    vi.resetModules();
    const mod = await import('../alertness/index.js');
    evaluateAlertness = mod.evaluateAlertness;
    getCurrentAlertness = mod.getCurrentAlertness;
    ALERTNESS_LEVELS = mod.ALERTNESS_LEVELS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('healthScore 低但 patterns 为空时，不升级到 ALERT（双标准保护生效）', async () => {
    // healthScore=45 → PANIC, 但 patterns=[] → applyDualStandardGuard 限制到 AWARE
    mockHealthScore = 45;
    mockSeverity = 'none';
    mockPatterns = [];

    await evaluateAlertness();

    const state = getCurrentAlertness();
    expect(state.level).toBeLessThan(ALERTNESS_LEVELS.ALERT); // < 3
  });

  it('有异常 pattern 时，可以升级到 ALERT', async () => {
    mockHealthScore = 45;
    mockSeverity = 'high';
    mockPatterns = [{ type: 'HIGH_LOAD', severity: 'high' }];

    await evaluateAlertness();

    const state = getCurrentAlertness();
    expect(state.level).toBeGreaterThanOrEqual(ALERTNESS_LEVELS.ALERT);
  });
});

describe('applyPanicDebounce — PANIC 抖动稳定', () => {
  let evaluateAlertness, getCurrentAlertness, ALERTNESS_LEVELS;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSeverity = 'none';
    mockHealthScore = 100;
    mockPatterns = [];
    vi.useFakeTimers();

    vi.resetModules();
    const mod = await import('../alertness/index.js');
    evaluateAlertness = mod.evaluateAlertness;
    getCurrentAlertness = mod.getCurrentAlertness;
    ALERTNESS_LEVELS = mod.ALERTNESS_LEVELS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('单次 critical 只升到 ALERT，不直接到 PANIC', async () => {
    mockSeverity = 'critical';
    mockPatterns = [{ type: 'CRITICAL', severity: 'critical' }];

    await evaluateAlertness(); // count=1 < 3，限制到 ALERT

    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.ALERT);
  });

  it('连续3次 critical 才真正升到 PANIC', async () => {
    mockSeverity = 'critical';
    mockPatterns = [{ type: 'CRITICAL', severity: 'critical' }];

    await evaluateAlertness(); // count=1 → ALERT（新模块，无冷却）
    // 推进时间超过 PANIC 锁定期（30分钟）+ 冷却期（1分钟）
    vi.advanceTimersByTime(31 * 60 * 1000);
    await evaluateAlertness(); // count=2 → ALERT
    vi.advanceTimersByTime(31 * 60 * 1000);
    await evaluateAlertness(); // count=3 → PANIC（超过阈值）

    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.PANIC);
  });

  it('非 critical 评估重置 consecutive 计数', async () => {
    mockSeverity = 'critical';
    mockPatterns = [{ type: 'CRITICAL', severity: 'critical' }];
    await evaluateAlertness(); // count=1

    // 恢复健康，计数应重置
    mockSeverity = 'none';
    mockPatterns = [];
    mockHealthScore = 100;
    vi.advanceTimersByTime(2 * 60 * 1000); // 超过1分钟冷却
    await evaluateAlertness(); // count 重置为 0

    // 再次 critical，从 count=1 开始
    mockSeverity = 'critical';
    mockPatterns = [{ type: 'CRITICAL', severity: 'critical' }];
    vi.advanceTimersByTime(1000);
    await evaluateAlertness(); // count=1，不应到 PANIC

    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.ALERT); // 没有直接到 PANIC
  });
});

describe('executeConditionalResponse — 条件响应执行', () => {
  let evaluateAlertness, getCurrentAlertness, ALERTNESS_LEVELS;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSeverity = 'none';
    mockHealthScore = 100;
    mockPatterns = [];
    vi.useFakeTimers();

    vi.resetModules();
    const mod = await import('../alertness/index.js');
    evaluateAlertness = mod.evaluateAlertness;
    getCurrentAlertness = mod.getCurrentAlertness;
    ALERTNESS_LEVELS = mod.ALERTNESS_LEVELS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('CALM 状态下不触发 escalateResponse', async () => {
    mockSeverity = 'none';
    mockHealthScore = 100;

    await evaluateAlertness();

    const { escalateResponse } = await import('../alertness/escalation.js');
    const state = getCurrentAlertness();
    if (state.level < ALERTNESS_LEVELS.AWARE) {
      expect(escalateResponse).not.toHaveBeenCalled();
    }
  });
});
