/**
 * 回归测试：Alertness 渐进式恢复 Bug 修复
 *
 * Bug：ALERT(3) → 所有指标恢复正常 → healthScore=100 → target=CALM(1)
 *      checkTransitionRules 因 diff=2 > 1 blocked → 永远卡在 ALERT
 *
 * 修复：当 target 被 skip 规则 block 时，自动降一级（stepTarget = currentLevel - 1）
 *
 * DoD 覆盖：D1, D2, D3, D4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateAlertness,
  getCurrentAlertness,
  ALERTNESS_LEVELS,
} from '../alertness/index.js';

// ============================================================
// Mock 依赖
// ============================================================

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

// 可控的 severity（通过模块级变量切换）
let mockSeverity = 'none';

vi.mock('../alertness/metrics.js', () => ({
  collectMetrics: vi.fn().mockImplementation(async () => ({
    memory: { value: 80, status: 'normal' },
    cpu: { value: 10, status: 'normal' },
    responseTime: { value: 500, status: 'normal' },
    errorRate: { value: 0, status: 'normal' },
    queueDepth: { value: 5, status: 'normal' },
  })),
  calculateHealthScore: vi.fn().mockReturnValue(100), // 始终健康
  getRecentMetrics: vi.fn().mockReturnValue({}),
  recordOperation: vi.fn(),
  recordTickTime: vi.fn(),
}));

vi.mock('../alertness/diagnosis.js', () => ({
  diagnoseProblem: vi.fn().mockImplementation(async () => ({
    issues: mockSeverity === 'none' ? [] : ['high_load'],
    patterns: mockSeverity === 'none' ? [] : [{ type: 'HIGH_LOAD', severity: mockSeverity }],
    severity: mockSeverity,
    summary: mockSeverity === 'none' ? '系统健康' : '检测到异常',
    recommendations: [],
    metrics: {},
  })),
  getAnomalyPatterns: vi.fn().mockReturnValue([]),
}));

// ============================================================
// 辅助：通过 high severity 诊断把 alertness 推到 ALERT
// 并确保冷却期已过（mock time 前进 2 分钟）
// ============================================================

async function driveToAlert() {
  mockSeverity = 'high';
  await evaluateAlertness();
  expect(getCurrentAlertness().level).toBe(ALERTNESS_LEVELS.ALERT);
  // 把时间推进 2 分钟，绕过冷却期
  vi.setSystemTime(Date.now() + 2 * 60 * 1000);
  // 切换回健康状态
  mockSeverity = 'none';
}

// ============================================================
// 测试用例
// ============================================================

describe('alertness 渐进式恢复 Bug 修复 (D1-D4)', () => {
  beforeEach(() => {
    mockSeverity = 'none';
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('D2: ALERT + healthScore=100 时，不直接跳到 CALM，只降到 AWARE', async () => {
    await driveToAlert();

    // 所有指标健康 → healthScore=100 → target=CALM(1)
    // 但 ALERT→CALM diff=2 被 block → 应降到 AWARE(2)
    await evaluateAlertness();

    const after = getCurrentAlertness();
    expect(after.level).toBe(ALERTNESS_LEVELS.AWARE);
  });

  it('D1: ALERT→CALM 被 block 时，自动尝试 ALERT→AWARE（stepTarget = currentLevel-1）', async () => {
    await driveToAlert();
    await evaluateAlertness();

    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.AWARE);
    expect(state.level).not.toBe(ALERTNESS_LEVELS.CALM);
    expect(state.level).not.toBe(ALERTNESS_LEVELS.ALERT);
  });

  it('D4: 渐进式降级时 reason 包含 "Step recovery"', async () => {
    await driveToAlert();
    await evaluateAlertness();

    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.AWARE);
    expect(state.reason).toContain('Step recovery');
  });

  it('D3: 两步恢复 ALERT→AWARE→CALM（完整路径）', async () => {
    // 第一步：ALERT → AWARE
    await driveToAlert();
    await evaluateAlertness();
    expect(getCurrentAlertness().level).toBe(ALERTNESS_LEVELS.AWARE);

    // 第二步：AWARE → CALM（再等冷却期）
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    await evaluateAlertness();
    expect(getCurrentAlertness().level).toBe(ALERTNESS_LEVELS.CALM);
  });

  it('D5: 升级路径不受影响（CALM → ALERT 仍正常工作）', async () => {
    // 确保当前是 CALM 状态（初始或从 ALERT 降下来后再等）
    // 先把状态变成 CALM
    mockSeverity = 'none';
    await evaluateAlertness(); // 如果当前不是 CALM，经过若干次降级后会到 CALM

    // 触发高严重度诊断
    mockSeverity = 'high';
    await evaluateAlertness();

    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.ALERT);
  });

  it('D5: AWARE 时如果指标健康，可以直接降到 CALM（不走 step recovery）', async () => {
    // 先升到 ALERT
    await driveToAlert();
    // 第一步：ALERT → AWARE
    await evaluateAlertness();
    expect(getCurrentAlertness().level).toBe(ALERTNESS_LEVELS.AWARE);

    // 再等冷却期
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);

    // AWARE→CALM diff=1，不需要 step recovery，直接允许
    await evaluateAlertness();
    const state = getCurrentAlertness();
    expect(state.level).toBe(ALERTNESS_LEVELS.CALM);
    // 直接转换时 reason 不包含 Step recovery
    expect(state.reason).not.toContain('Step recovery');
  });
});
