import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordActionReceipt = vi.fn().mockResolvedValue('r-1');
const resolveActionReceipt = vi.fn().mockResolvedValue(true);
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));
vi.mock('../muted-guard.js', () => ({ isMuted: vi.fn().mockReturnValue(false) }));

import { isMuted } from '../muted-guard.js';

const ENV_KEYS = ['FEISHU_BOT_WEBHOOK', 'BARK_TOKEN', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_OWNER_OPEN_IDS'];

async function loadNotifier(env = {}) {
  vi.resetModules();
  const orig = {};
  for (const [k, v] of Object.entries(env)) {
    orig[k] = process.env[k];
    process.env[k] = v;
  }
  const mod = await import('../notifier.js');
  return { mod, restore: () => {
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  } };
}

describe('notifier 回执接线（T4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordActionReceipt.mockResolvedValue('r-1');
    resolveActionReceipt.mockResolvedValue(true);
    isMuted.mockReturnValue(false);
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it('sendFeishu webhook 成功 → record(feishu/webhook) + resolve confirmed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(true);
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'feishu', target: 'webhook' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'confirmed', expect.objectContaining({ http_status: 200 }));
  });

  it('sendFeishu webhook 非 2xx → resolve failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(false);
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'failed', expect.objectContaining({ http_status: 500 }));
  });

  it('sendFeishu webhook fetch 抛错 → resolve failed（error 证据）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(false);
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'failed', expect.objectContaining({ error: 'boom' }));
  });

  it('muted → 不写回执', async () => {
    isMuted.mockReturnValue(true);
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    await mod.sendFeishu('hello');
    restore();
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('sendBark 成功 → record(bark) + resolve confirmed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ code: 200 }) });
    const { mod, restore } = await loadNotifier({ BARK_TOKEN: 'tok' });
    const ok = await mod.sendBark('t', 'b');
    restore();
    expect(ok).toBe(true);
    expect(recordActionReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bark' }));
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'confirmed', expect.anything());
  });

  it('sendBark code≠200 → resolve failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ code: 400, message: 'bad' }) });
    const { mod, restore } = await loadNotifier({ BARK_TOKEN: 'tok' });
    const ok = await mod.sendBark('t', 'b');
    restore();
    expect(ok).toBe(false);
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'failed', expect.anything());
  });

  it('BARK_TOKEN 未配置 → 不写回执', async () => {
    vi.resetModules();
    delete process.env.BARK_TOKEN;
    const mod2 = await import('../notifier.js');
    await mod2.sendBark('t', 'b');
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('receipt-collector 写入抛错 → 通知照发（fail-open）', async () => {
    recordActionReceipt.mockRejectedValueOnce(new Error('db down'));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(true);
  });
});
