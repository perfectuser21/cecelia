import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

let withThalamusTimeout;
beforeAll(async () => {
  ({ withThalamusTimeout } = await import('../../tick-runner.js'));
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('tick-runner 丘脑超时保护', () => {
  it('默认30秒边界之前不结算，到期返回fallback并清理计时器', async () => {
    const settled = vi.fn();
    const pending = withThalamusTimeout(new Promise(() => {}));
    pending.then(settled);

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({
      actions: [{ type: 'fallback_to_tick' }], level: 'timeout', timed_out: true,
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('提前成功返回真实结果并清理超时器，30秒后不会再次结算', async () => {
    let resolveWork;
    const result = { actions: [{ type: 'dispatch_task' }] };
    const settled = vi.fn();
    const pending = withThalamusTimeout(new Promise(resolve => { resolveWork = resolve; }));
    pending.then(settled);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    resolveWork(result);
    await expect(pending).resolves.toBe(result);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(result);
  });
});
