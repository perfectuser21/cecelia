import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));
vi.mock('../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
let triggerN8n;
const outbound = vi.fn();
beforeAll(async () => {
  vi.stubEnv('N8N_API_URL', 'https://n8n.test.invalid');
  vi.stubEnv('N8N_API_KEY', 'unit-test-n8n-key');
  vi.stubGlobal('fetch', outbound);
  vi.resetModules();
  triggerN8n = (await import('../actions.js')).triggerN8n;
});
beforeEach(() => {
  outbound.mockReset(); outbound.mockResolvedValue({ ok: true, status: 200, text: async () => 'accepted' });
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('trusted N8N webhook destination', () => {
  it.each(['hook-name', 'nested/hook-name', 'https://n8n.test.invalid/webhook/hook-name', '/webhook/hook-name'])('valid webhook %s stays on trusted origin with bounded transport', async webhook_path => {
    const response = await triggerN8n({ webhook_path, data: { text: 'payload' } });
    expect(response.success).toBe(true);
    expect(outbound).toHaveBeenCalledOnce();
    const [url, options] = outbound.mock.calls[0];
    expect(new URL(url).origin).toBe('https://n8n.test.invalid');
    expect(new URL(url).pathname).toMatch(/^\/webhook\/(?:nested\/)?hook-name$/);
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-N8N-API-KEY': 'unit-test-n8n-key' }, body: '{"text":"payload"}' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['hook?token=a?b', '/webhook/hook?token=a?b'])('keeps the full query in %s equivalent to an absolute webhook', async webhook_path => {
    expect((await triggerN8n({ webhook_path })).success).toBe(true);
    const relativeUrl = outbound.mock.calls[0][0];
    expect((await triggerN8n({ webhook_path: 'https://n8n.test.invalid/webhook/hook?token=a?b' })).success).toBe(true);
    expect(relativeUrl).toBe('https://n8n.test.invalid/webhook/hook?token=a%3Fb');
    expect(outbound.mock.calls[1][0]).toBe(relativeUrl);
  });

  it.each(['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'https://attacker.invalid/webhook/hook',
    '//attacker.invalid/webhook/hook', 'https://n8n.test.invalid.attacker.invalid/webhook/hook',
    'https://n8n.test.invalid@attacker.invalid/webhook/hook', 'https://user:pass@n8n.test.invalid/webhook/hook',
    'https://n8n.test.invalid/admin', 'https://n8n.test.invalid/webhook/../admin', '/webhook/../admin', '../admin',
    '%2e%2e/admin', '%252e%252e/admin', 'safe/%2fadmin', 'safe\\admin', 'safe#fragment', '', null])('reject %s before any credential-bearing request', async webhook_path => {
    const response = await triggerN8n({ webhook_path, data: {} });
    expect(response.success).toBe(false);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('sets a ten-second timeout and reports its abort as failure', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(AbortSignal.abort(new DOMException('deadline reached', 'TimeoutError')));
    outbound.mockImplementationOnce(async (_url, { signal }) => { signal.throwIfAborted(); });
    try {
      const response = await triggerN8n({ webhook_path: 'hook-name' });
      expect(timeout).toHaveBeenCalledWith(10000);
      expect(response).toMatchObject({ success: false, error: 'deadline reached' });
      expect(outbound).toHaveBeenCalledOnce();
    } finally { timeout.mockRestore(); }
  });

  it('redirect refusal remains a failure and never issues a second request', async () => {
    outbound.mockRejectedValueOnce(TypeError('redirect mode is set to error'));
    const response = await triggerN8n({ webhook_path: 'hook-name' });
    expect(response.success).toBe(false);
    expect(outbound).toHaveBeenCalledOnce();
    expect(outbound.mock.calls[0][1].redirect).toBe('error');
  });
});
