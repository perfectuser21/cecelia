/**
 * notifier-muted-gate.test.js
 *
 * 测试 BRAIN_MUTED env 单一出口 gate：
 * - 严格 === "true" 才静默
 * - 其他值（unset / "" / "false" / "1" / "yes"）均正常
 * - sendFeishu 和 sendFeishuOpenAPI 都受 gate 控制
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const originalEnv = { ...process.env };

async function loadNotifier(envOverrides = {}) {
  delete process.env.FEISHU_BOT_WEBHOOK;
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  delete process.env.FEISHU_OWNER_OPEN_IDS;
  delete process.env.BRAIN_MUTED;
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }
  vi.resetModules();
  return import('../notifier.js');
}

describe('BRAIN_MUTED gate — notifier.js 单一出口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('场景 1: BRAIN_MUTED=true → sendFeishu 不 fetch，返回 false', async () => {
    const { sendFeishu } = await loadNotifier({
      FEISHU_BOT_WEBHOOK: 'https://webhook.test',
      BRAIN_MUTED: 'true',
    });
    const result = await sendFeishu('test message');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('场景 2: BRAIN_MUTED=true → sendFeishuOpenAPI 降级路径也不 fetch', async () => {
    const mod = await loadNotifier({
      FEISHU_APP_ID: 'a',
      FEISHU_APP_SECRET: 's',
      FEISHU_OWNER_OPEN_IDS: 'ou_alex',
      BRAIN_MUTED: 'true',
    });
    const result = await mod.sendFeishu('test');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('场景 3: BRAIN_MUTED=false → sendFeishu 正常走 fetch', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) });
    const { sendFeishu } = await loadNotifier({
      FEISHU_BOT_WEBHOOK: 'https://webhook.test',
      BRAIN_MUTED: 'false',
    });
    await sendFeishu('test');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://webhook.test', expect.any(Object));
  });

  it('场景 4: BRAIN_MUTED 未设 → 正常走 fetch（默认不静默）', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) });
    const { sendFeishu } = await loadNotifier({
      FEISHU_BOT_WEBHOOK: 'https://webhook.test',
    });
    await sendFeishu('test');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('场景 5: BRAIN_MUTED="" → 正常走 fetch（空串不等于 "true"）', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) });
    const { sendFeishu } = await loadNotifier({
      FEISHU_BOT_WEBHOOK: 'https://webhook.test',
      BRAIN_MUTED: '',
    });
    await sendFeishu('test');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('场景 6: BRAIN_MUTED="1" 或 "yes" → 正常走 fetch（严格 "true" 才静默）', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) });

    const mod1 = await loadNotifier({
      FEISHU_BOT_WEBHOOK: 'https://webhook.test',
      BRAIN_MUTED: '1',
    });
    await mod1.sendFeishu('test-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0 }) });
    const mod2 = await loadNotifier({
      FEISHU_BOT_WEBHOOK: 'https://webhook.test',
      BRAIN_MUTED: 'yes',
    });
    await mod2.sendFeishu('test-yes');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
