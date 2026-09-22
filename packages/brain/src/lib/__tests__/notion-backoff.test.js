import { describe, it, expect, vi } from 'vitest';
import { withBackoff, defaultIsRetryable } from '../notion-backoff.js';

const httpErr = (status) => Object.assign(new Error(`Notion → ${status}`), { status });

describe('withBackoff', () => {
  it('429 → 指数退避 100/200/400 后第 4 次成功', async () => {
    const sleeps = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(httpErr(429)).mockRejectedValueOnce(httpErr(503))
      .mockRejectedValueOnce(httpErr(500)).mockResolvedValueOnce({ ok: 1 });
    const out = await withBackoff(fn, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(out).toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });
  it('4 次仍 429 → 抛最后一次错误', async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(429));
    await expect(withBackoff(fn, { sleep: async () => {} })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(4);
  });
  it('400/404 不重试', async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(404));
    await expect(withBackoff(fn, { sleep: async () => {} })).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('网络错误（无 status）不重试', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(withBackoff(fn, { sleep: async () => {} })).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(defaultIsRetryable(new Error('x'))).toBe(false);
  });
});
