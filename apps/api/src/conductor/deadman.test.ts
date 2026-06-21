// deadman 测试 — stale 报红时接飞书告警。
// 飞书 fetch mock; webhook env 缺失必须降级(打日志不崩, 不写死 key)。
// process.exit 在 deadmanCheck 里, 故只直接测可导出的告警函数 + stale 判定逻辑。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

import {
  beat,
  HEARTBEAT_FILE,
  isStale,
  alertFeishu,
} from './deadman.mjs';

function cleanHeartbeat() {
  if (fs.existsSync(HEARTBEAT_FILE)) fs.unlinkSync(HEARTBEAT_FILE);
}

describe('isStale 判定(纯逻辑, 与告警解耦便于测)', () => {
  beforeEach(cleanHeartbeat);
  afterEach(cleanHeartbeat);

  it('无心跳文件 → stale', () => {
    const r = isStale();
    expect(r.stale).toBe(true);
    expect(r.reason).toContain('无心跳');
  });

  it('刚 beat → 不 stale', () => {
    beat('contract');
    const r = isStale();
    expect(r.stale).toBe(false);
    expect(r.stage).toBe('contract');
  });

  it('心跳超阈值 → stale, 带 stage + age', () => {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({ ts: Date.now() - 999_000, stage: 'a-lane' }));
    const r = isStale(60_000);
    expect(r.stale).toBe(true);
    expect(r.stage).toBe('a-lane');
    expect(r.ageMs).toBeGreaterThan(60_000);
  });
});

describe('alertFeishu — webhook env 缺失降级', () => {
  beforeEach(() => {
    delete process.env.FEISHU_BOT_WEBHOOK;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FEISHU_BOT_WEBHOOK;
  });

  it('无 webhook → 不调 fetch, 返回 false, 不抛', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const ok = await alertFeishu({ stage: 'gate', ageMs: 120_000, reason: 'stale' });
    expect(spy).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});

describe('alertFeishu — webhook 配了走飞书 (fetch mock)', () => {
  beforeEach(() => {
    process.env.FEISHU_BOT_WEBHOOK = 'https://open.feishu.cn/hook/xyz';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FEISHU_BOT_WEBHOOK;
  });

  it('发飞书文本告警, 带 stage + age', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await alertFeishu({ stage: 'a-lane', ageMs: 125_000, reason: '心跳 stale' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.feishu.cn/hook/xyz');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toContain('a-lane');
    expect(body.content.text).toContain('125'); // age 秒
    expect(ok).toBe(true);
  });

  it('飞书 fetch 抛错 → 返回 false, 不抛(告警失败不能拖垮 deadman)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('feishu down'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      alertFeishu({ stage: 'gate', ageMs: 90_000, reason: 'stale' }),
    ).resolves.toBe(false);
  });
});
