/**
 * Tests for burst limiter mechanism (MAX_NEW_DISPATCHES_PER_TICK)
 * 防止队列积压后资源恢复时多个 agent 同时启动触发雪崩
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
  __mockQuery: mockQuery,
}));

vi.mock('../executor.js', () => ({
  checkServerResources: vi.fn(() => ({ ok: true, metrics: { max_pressure: 0.3 } })),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
  getActiveProcessCount: vi.fn(() => 0),
  killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn(),
  probeTaskLiveness: vi.fn(() => []),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
}));

vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(() => ({ level: 1, levelName: 'CALM' })),
  evaluateAlertness: vi.fn(),
  initAlertness: vi.fn(),
  canDispatch: vi.fn(() => true),
  canPlan: vi.fn(() => true),
  getDispatchRate: vi.fn(() => 1.0),
  ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'],
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn(() => ({
    dispatchAllowed: true,
    taskPool: { budget: 10, available: 5 }, // 5 个 slot 可用
    user: { mode: 'absent', used: 0 },
    backpressure: { queue_depth: 0, threshold: 5, active: false, override_burst_limit: null },
  })),
}));

let MAX_NEW_DISPATCHES_PER_TICK;

beforeAll(async () => {
  vi.resetModules();
  const tickMod = await import('../tick.js');
  MAX_NEW_DISPATCHES_PER_TICK = tickMod.MAX_NEW_DISPATCHES_PER_TICK;
});

describe('MAX_NEW_DISPATCHES_PER_TICK 常量', () => {
  it('应该等于 2（防雪崩默认上限）', () => {
    expect(MAX_NEW_DISPATCHES_PER_TICK).toBe(2);
  });
});

describe('burst limiter 代码路径验证', () => {
  it('tick.js 中应包含 MAX_NEW_DISPATCHES_PER_TICK 常量定义', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    expect(src).toContain('MAX_NEW_DISPATCHES_PER_TICK = 2');
  });

  it('tick.js 中 7a 循环应有 burst limiter 检查（使用 effectiveBurstLimit）', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    expect(src).toContain('newDispatchCount >= effectiveBurstLimit');
  });

  it('tick.js 中应有 burst_limited 日志输出', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    expect(src).toContain('burst_limited');
  });

  it('tick.js 中 7b 循环也应有 burst limiter 检查（使用 effectiveBurstLimit）', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    // 至少出现 2 次（7a + 7b）
    const matches = src.match(/newDispatchCount >= effectiveBurstLimit/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('dispatch 返回对象应包含 burst_limited 字段定义', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    expect(src).toContain('burst_limited: burstLimited');
  });
});
