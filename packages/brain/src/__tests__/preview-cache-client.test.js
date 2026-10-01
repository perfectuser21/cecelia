import { it, expect, vi } from 'vitest';
import { createPreviewCacheClient } from '../preview-cache-client.js';
  it('缺token零HTTP；固定MMV路径、禁redirect、超时信号，receipt拒非UUID', async () => {
    const transport = vi.fn(async () => ({ ok: true, text: async () => '{}' }));
    await expect(createPreviewCacheClient({ token: '', transport }).plan()).rejects.toThrow('PREVIEW_TOKEN_MISSING');
    expect(transport).not.toHaveBeenCalled();
    const client = createPreviewCacheClient({ token: 'fixture', transport }); await client.plan();
    expect(transport.mock.calls[0][0]).toBe('http://100.71.151.105:5241/api/brain/preview/janitor/cache/plan');
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST', signal: expect.any(AbortSignal) });
    expect(() => client.receipt('../../path')).toThrow('INVALID_INTENT');
  });
