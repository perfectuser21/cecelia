import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callRadius } from '../../../packages/brain/src/lib/radius-client.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('radius-client 请求契约及失败清理（补充原生 radius-client.test.js）', () => {
  it('把全部改动文件编码为 POST JSON，并在成功后取消超时', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ affected_features: [], affected_tests: ['tests/a.test.js'], freshness: { stale: false } }) });
    vi.stubGlobal('fetch', fetch);
    const result = await callRadius(['src/a.js', '带 空格.js']);
    expect(result.affected_tests).toEqual(['tests/a.test.js']);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/brain\/graph\/radius$/);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ files: ['src/a.js', '带 空格.js'] });
    expect(options.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(options.signal.aborted).toBe(false);
  });

  it('JSON 损坏时返回 null 并清理超时', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }));
    await expect(callRadius(['src/a.js'])).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('HTTP 错误不尝试消费响应 JSON，并清理超时', async () => {
    const json = vi.fn().mockRejectedValue(new Error('must not parse error body'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json }));
    await expect(callRadius(['src/a.js'])).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
