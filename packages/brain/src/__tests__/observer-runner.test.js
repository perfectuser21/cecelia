/**
 * Brain v2 Phase E1 — observer-runner 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 3 channel deps
vi.mock('../alertness/index.js', () => ({
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 2, level_name: 'AWARE', score: 0.5 }),
}));
vi.mock('../health-monitor.js', () => ({
  runLayer2HealthCheck: vi.fn().mockResolvedValue({ summary: 'healthy', layer2_status: 'ok' }),
}));
vi.mock('../executor.js', () => ({
  checkServerResources: vi.fn().mockReturnValue({ busy_seats: 2, max_seats: 10 }),
}));

import {
  observerState,
  runOnce,
  initObserverRunner,
  stopObserverRunner,
  _resetObserverForTests,
} from '../observer-runner.js';
import { evaluateAlertness } from '../alertness/index.js';
import { runLayer2HealthCheck } from '../health-monitor.js';
import { checkServerResources } from '../executor.js';

describe('observer-runner', () => {
  beforeEach(() => {
    _resetObserverForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopObserverRunner();
  });

  it('runOnce 刷新 3 个 channel 写 observerState', async () => {
    const result = await runOnce();
    expect(result.skipped).toBe(false);
    expect(result.error).toBeNull();
    expect(observerState.alertness).toEqual({ level: 2, level_name: 'AWARE', score: 0.5 });
    expect(observerState.health).toEqual({ summary: 'healthy', layer2_status: 'ok' });
    expect(observerState.resources).toEqual({ busy_seats: 2, max_seats: 10 });
    expect(observerState.last_run_at).toBeTruthy();
    expect(observerState.run_count).toBe(1);
  });

  it('runOnce 防重入：上次未完跳过', async () => {
    let resolveAlertness;
    evaluateAlertness.mockImplementationOnce(() => new Promise((r) => { resolveAlertness = r; }));
    const p1 = runOnce(); // 长跑
    const p2 = await runOnce(); // 第二次立即返回 skipped
    expect(p2.skipped).toBe(true);
    expect(p2.reason).toBe('already_running');
    resolveAlertness({ level: 1 });
    await p1;
  });

  it('一个 channel reject 不影响其他 channel + 记 error', async () => {
    runLayer2HealthCheck.mockRejectedValueOnce(new Error('layer2 down'));
    const result = await runOnce();
    expect(result.error).toContain('layer2 down');
    expect(observerState.alertness).toEqual({ level: 2, level_name: 'AWARE', score: 0.5 });
    expect(observerState.health).toBeNull();  // failed channel 仍 null（无 cached prev value）
    expect(observerState.resources).toEqual({ busy_seats: 2, max_seats: 10 });
    expect(observerState.last_run_error).toContain('layer2 down');
  });

  it('initObserverRunner 立即跑一次 + 启动 setInterval', async () => {
    const result = await initObserverRunner();
    expect(result.started).toBe(true);
    expect(result.interval_ms).toBeGreaterThan(0);
    expect(observerState.run_count).toBe(1);
  });

  it('initObserverRunner 幂等：二次调跳过', async () => {
    await initObserverRunner();
    const result = await initObserverRunner();
    expect(result.started).toBe(false);
    expect(result.reason).toBe('already_running');
  });

  it('stopObserverRunner 清 timer', async () => {
    await initObserverRunner();
    const result = stopObserverRunner();
    expect(result.stopped).toBe(true);
    const result2 = stopObserverRunner();
    expect(result2.stopped).toBe(false);
  });
});
