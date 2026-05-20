/**
 * __tests__/clips-extractor.test.js
 * Tests the extractClip function
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
global.fetch = vi.fn();

describe('extractClip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls content-service proxy with url and callback_url', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ queued: true }),
    });

    const { extractClip } = await import('../clips-extractor.js');
    await extractClip('test-uuid', 'https://v.douyin.com/abc123');

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/transcribe');
    const body = JSON.parse(opts.body);
    expect(body.url).toBe('https://v.douyin.com/abc123');
    expect(body.callback_url).toContain('test-uuid');
  });

  it('throws if content-service returns non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const { extractClip } = await import('../clips-extractor.js');
    await expect(extractClip('id-2', 'https://v.douyin.com/xyz')).rejects.toThrow('503');
  });
});
