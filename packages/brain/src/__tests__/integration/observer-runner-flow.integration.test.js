/**
 * Brain v2 Phase E1 — observer-runner 真后台 setInterval E2E
 *
 * 验证：
 *   1. mock 3 channel deps（evaluateAlertness / runLayer2HealthCheck / checkServerResources）
 *   2. initObserverRunner 真启 setInterval（短 interval 加速测试）
 *   3. await 100ms → 首次 runOnce 完成，3 channel 全 populated + run_count=1
 *   4. await 150ms → setInterval 真后台跑 → run_count >= 2
 *   5. stopObserverRunner 清 timer
 *
 * 注：
 *   - OBSERVER_INTERVAL_MS 在 observer-runner.js module load 时读 env，
 *     ESM hoists imports → 必须用 dynamic import 在 env 设好后再 load module。
 *   - 真用 setInterval（不 fake timers），让"后台跑"是真的
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const OBSERVER_INTERVAL_MS = 80;

// ── Mock 3 channel deps（vi.mock 被 hoist 到 import 之前）─────────────────
vi.mock('../../alertness/index.js', () => ({
  evaluateAlertness: vi.fn().mockResolvedValue({
    level: 2, level_name: 'AWARE', score: 0.5,
  }),
}));
vi.mock('../../health-monitor.js', () => ({
  runLayer2HealthCheck: vi.fn().mockResolvedValue({
    summary: 'healthy', layer2_status: 'ok',
  }),
}));
vi.mock('../../executor.js', () => ({
  checkServerResources: vi.fn().mockReturnValue({ busy_seats: 2, max_seats: 10 }),
}));

// 动态 import：env 设好后再 load observer-runner.js
let observerState;
let initObserverRunner;
let stopObserverRunner;
let _resetObserverForTests;
let evaluateAlertness;
let runLayer2HealthCheck;
let checkServerResources;

beforeAll(async () => {
  process.env.CECELIA_OBSERVER_INTERVAL_MS = String(OBSERVER_INTERVAL_MS);
  ({
    observerState,
    initObserverRunner,
    stopObserverRunner,
    _resetObserverForTests,
  } = await import('../../observer-runner.js'));
  ({ evaluateAlertness } = await import('../../alertness/index.js'));
  ({ runLayer2HealthCheck } = await import('../../health-monitor.js'));
  ({ checkServerResources } = await import('../../executor.js'));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('observer-runner real-interval flow E2E', () => {
  beforeEach(() => {
    _resetObserverForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopObserverRunner();
  });

  it('initObserverRunner → 100ms 后 run_count=1 + observerState 3 channel populated', async () => {
    const startResult = await initObserverRunner();
    expect(startResult.started).toBe(true);
    expect(startResult.interval_ms).toBe(OBSERVER_INTERVAL_MS);

    // observer-runner.initObserverRunner 内部 await runOnce()，所以返回时 run_count 已=1
    expect(observerState.run_count).toBe(1);
    expect(observerState.alertness).toEqual({ level: 2, level_name: 'AWARE', score: 0.5 });
    expect(observerState.health).toEqual({ summary: 'healthy', layer2_status: 'ok' });
    expect(observerState.resources).toEqual({ busy_seats: 2, max_seats: 10 });
    expect(observerState.last_run_at).toBeTruthy();
    expect(observerState.last_run_error).toBeNull();

    // 3 channel deps 各被调用至少 1 次（首次 runOnce）
    expect(evaluateAlertness).toHaveBeenCalledTimes(1);
    expect(runLayer2HealthCheck).toHaveBeenCalledTimes(1);
    expect(checkServerResources).toHaveBeenCalledTimes(1);
  });

  it('200ms 后 setInterval 真后台跑 → run_count >= 2 + 3 channel mocks 累计 >=2 调用', async () => {
    await initObserverRunner();
    expect(observerState.run_count).toBe(1);

    // 等 setInterval 真后台跑 — interval=80ms，等 220ms 应跑过 2 次以上
    await sleep(220);

    expect(observerState.run_count).toBeGreaterThanOrEqual(2);
    // 三个 channel mock 被多次调用
    expect(evaluateAlertness.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(runLayer2HealthCheck.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(checkServerResources.mock.calls.length).toBeGreaterThanOrEqual(2);

    // observerState 仍含合规快照（最近一次 run）
    expect(observerState.alertness).toEqual({ level: 2, level_name: 'AWARE', score: 0.5 });
    expect(observerState.last_run_error).toBeNull();
  });

  it('stopObserverRunner 后 setInterval 不再触发 runOnce', async () => {
    await initObserverRunner();
    const baseline = observerState.run_count;
    expect(baseline).toBe(1);

    const stopRes = stopObserverRunner();
    expect(stopRes.stopped).toBe(true);

    // 等超过 2 个 interval 周期
    await sleep(OBSERVER_INTERVAL_MS * 3);

    // run_count 应保持不动（timer 已清）
    expect(observerState.run_count).toBe(baseline);

    // 二次 stop 返回 not_running
    const stopAgain = stopObserverRunner();
    expect(stopAgain.stopped).toBe(false);
    expect(stopAgain.reason).toBe('not_running');
  });
});
