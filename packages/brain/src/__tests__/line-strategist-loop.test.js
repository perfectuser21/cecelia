import { describe, it, expect, vi } from 'vitest';
import { runLineStrategistDispatchOnce, startLineStrategistLoop, stopLineStrategistLoop } from '../line-strategist-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

describe('line-strategist-loop', () => {
  it('一次执行调用 dispatchStrategistDecisions 并透传其返回值', async () => {
    const dispatchStrategistDecisions = vi.fn(async () => ({ scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2 }));
    const r = await runLineStrategistDispatchOnce({ pool: fakePool, dispatchStrategistDecisions });
    expect(dispatchStrategistDecisions).toHaveBeenCalledTimes(1);
    expect(dispatchStrategistDecisions).toHaveBeenCalledWith(fakePool);
    expect(r).toMatchObject({ scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2 });
  });

  it('dispatchStrategistDecisions 抛错时 non-fatal 容错，不让 loop 崩', async () => {
    const dispatchStrategistDecisions = vi.fn(async () => { throw new Error('boom'); });
    const r = await runLineStrategistDispatchOnce({ pool: fakePool, dispatchStrategistDecisions });
    expect(r.error).toBe('boom');
  });
});

describe('line-strategist-loop start/stop（独立 setInterval，重复启动幂等）', () => {
  it('startLineStrategistLoop 首次 true、重复 false；stop 后可再启动', () => {
    const first = startLineStrategistLoop({ intervalMs: 999999 });
    const second = startLineStrategistLoop({ intervalMs: 999999 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    stopLineStrategistLoop();
    const third = startLineStrategistLoop({ intervalMs: 999999 });
    expect(third).toBe(true);
    stopLineStrategistLoop();
  });
});
