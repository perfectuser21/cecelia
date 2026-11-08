import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ query: vi.fn(), guidance: vi.fn(), set: vi.fn(), graph: vi.fn(), invoke: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('../guidance.js', () => ({ getGuidance: io.guidance, setGuidance: io.set }));
vi.mock('../workflows/consciousness.graph.js', () => ({ getCompiledConsciousnessGraph: io.graph }));
vi.mock('../consciousness-guard.js', () => ({ isConsciousnessEnabled: () => true }));
const completed = { completed_steps: ['thalamus', 'decision', 'rumination', 'plan'], errors: [] };
let loop, savedThread;
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); vi.resetAllMocks(); savedThread = null;
  io.guidance.mockImplementation(async key => { expect(key).toBe('consciousness:active_thread'); return savedThread; });
  io.set.mockImplementation(async (key, value) => { expect(key).toBe('consciousness:active_thread'); savedThread = value; });
  io.query.mockImplementation(async (sql, values) => {
    expect(sql).toMatch(/^DELETE FROM brain_guidance/); expect(values).toEqual(['consciousness:active_thread']); savedThread = null; return { rows: [] };
  });
  io.invoke.mockResolvedValue(completed); io.graph.mockResolvedValue({ invoke: io.invoke });
  loop = await import('../consciousness-loop.js');
});
afterEach(() => { loop.stopConsciousnessLoop(); vi.clearAllTimers(); vi.useRealTimers(); });

it.each(['resolve', 'reject'])('超时返回后旧invoke仍pending必须阻挡重入，晚%s后允许同thread恢复', async settlement => {
  let resolveInvoke, rejectInvoke, entered;
  const called = new Promise(resolve => { entered = resolve; });
  const pending = new Promise((resolve, reject) => { resolveInvoke = resolve; rejectInvoke = reject; });
  io.invoke.mockImplementationOnce(() => { entered(); return pending; });
  try {
    const first = loop._runConsciousnessOnce({ timeoutMs: 100 });
    await called;
    const thread = io.invoke.mock.calls[0][1].configurable.thread_id;
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ completed: false, timedOut: true, actions: [] });
    expect(savedThread).toEqual({ thread_id: thread });
    expect(io.query).not.toHaveBeenCalled();
    expect(await loop._runConsciousnessOnce({ timeoutMs: 100 })).toEqual({ completed: false, reason: 'already_running', actions: [] });
    expect(io.invoke).toHaveBeenCalledOnce();
    if (settlement === 'resolve') resolveInvoke(completed); else rejectInvoke(Error('owned late graph failure'));
    await vi.advanceTimersByTimeAsync(0);
    // 超时后的checkpoint仍交由真实loop按原约定续跑，晚结果不并发清理thread。
    expect(io.query).not.toHaveBeenCalled();
    expect(await loop._runConsciousnessOnce({ timeoutMs: 100 })).toEqual({ completed: true, actions: completed.completed_steps });
    expect(io.invoke).toHaveBeenCalledTimes(2);
    expect(io.invoke.mock.calls[1]).toEqual([null, { configurable: { thread_id: thread } }]);
    expect(io.query).toHaveBeenCalledOnce();
    expect(savedThread).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    resolveInvoke(completed);
    await vi.advanceTimersByTimeAsync(0);
  }
});
it('正常invoke结束及时释放锁并取消超时计时器', async () => {
  expect(await loop._runConsciousnessOnce({ timeoutMs: 100 })).toMatchObject({ completed: true });
  expect(vi.getTimerCount()).toBe(0);
  expect(await loop._runConsciousnessOnce({ timeoutMs: 100 })).toMatchObject({ completed: true });
  expect(io.invoke).toHaveBeenCalledTimes(2);
});
it('invoke在超时前失败仍返回原error并释放锁', async () => {
  io.invoke.mockRejectedValueOnce(Error('owned graph failure'));
  expect(await loop._runConsciousnessOnce({ timeoutMs: 100 })).toEqual({ completed: false, error: 'owned graph failure', actions: [] });
  expect(vi.getTimerCount()).toBe(0);
  expect(await loop._runConsciousnessOnce({ timeoutMs: 100 })).toMatchObject({ completed: true });
});
