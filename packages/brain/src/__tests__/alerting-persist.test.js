/**
 * alerting 缓冲持久化回归测试
 *
 * Bug：raise() 对 P1/P2 只 push 进内存缓冲，Brain 部署重启（一天多次）后缓冲丢失，
 * P2 每日汇总永远发不出去（0929 recurring_* 告警静默丢失）。
 * 修复：缓冲落 working_memory（key=alerting_buffers），重启后首次使用时恢复。
 *
 * 用 vi.resetModules() + 重新 import 模拟 Brain 重启（模块级内存状态清零，DB 状态保留）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store, queryMock, sendMock, digestMock } = vi.hoisted(() => {
  const store = new Map();
  const queryMock = vi.fn(async (sql, params = []) => {
    if (/^\s*SELECT/i.test(sql)) {
      const v = store.get(params[0]);
      return { rows: v === undefined ? [] : [{ value_json: JSON.parse(JSON.stringify(v)) }] };
    }
    if (/^\s*INSERT/i.test(sql)) {
      const val = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      store.set(params[0], JSON.parse(JSON.stringify(val)));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  });
  const sendMock = vi.fn().mockResolvedValue(true);
  // P1/P2 汇总只走专用系统通道 ALERT_DIGEST_WEBHOOK（决策 d3e7746c），用 fetch mock 观察汇总投递
  const digestMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  return { store, queryMock, sendMock, digestMock };
});

vi.mock('../db.js', () => ({ default: { query: queryMock } }));
vi.mock('../notifier.js', () => ({ sendFeishu: sendMock }));

async function bootAlerting() {
  vi.resetModules();
  return import('../alerting.js');
}

function sentTexts() {
  return digestMock.mock.calls.map(c => JSON.parse(c[1].body).content.text);
}

describe('alerting 缓冲持久化（重启不丢 P1/P2）', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    store.clear();
    queryMock.mockClear();
    sendMock.mockClear();
    sendMock.mockResolvedValue(true);
    digestMock.mockClear();
    digestMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = digestMock;
    process.env.ALERT_DIGEST_WEBHOOK = 'https://example.invalid/digest-hook';
  });

  afterEach(() => {
    global.fetch = origFetch;
    delete process.env.ALERT_DIGEST_WEBHOOK;
  });

  it('重启后未 flush 的 P2 仍会在下次 flush 发出', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P2', 'recurring_skip', 'recurring_foo 连续跳过');
    expect(digestMock).not.toHaveBeenCalled();

    // 模拟部署重启
    const a2 = await bootAlerting();
    await a2.flushP2();

    expect(digestMock).toHaveBeenCalledTimes(1);
    expect(sentTexts()[0]).toContain('[P2 每日记录] 1 条');
    expect(sentTexts()[0]).toContain('recurring_foo 连续跳过');
  });

  it('重启后未 flush 的 P1 同样恢复', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P1', 'task_quarantined', 'P1 隔离告警');

    const a2 = await bootAlerting();
    await a2.flushP1();

    expect(digestMock).toHaveBeenCalledTimes(1);
    expect(sentTexts()[0]).toContain('P1 隔离告警');
  });

  it('重启后先 raise 再 flush：恢复项与新项合并发出', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P2', 'e1', '旧告警');

    const a2 = await bootAlerting();
    await a2.raise('P2', 'e2', '新告警');
    expect(a2.getStatus().p2_pending).toBe(2);
    await a2.flushP2();

    expect(digestMock).toHaveBeenCalledTimes(1);
    expect(sentTexts()[0]).toContain('[P2 每日记录] 2 条');
    expect(sentTexts()[0]).toContain('旧告警');
    expect(sentTexts()[0]).toContain('新告警');
  });

  it('flush 后重启不重复发送', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P2', 'e1', '只发一次');
    await a1.flushP2();
    expect(digestMock).toHaveBeenCalledTimes(1);

    const a2 = await bootAlerting();
    await a2.flushP2();
    expect(digestMock).toHaveBeenCalledTimes(1);
    expect(a2.getStatus().p2_pending).toBe(0);
  });

  it('P2 每日节奏跨重启保留：刚 flush 过则重启后不会立刻再发，缓冲保留', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P2', 'e1', '第一批');
    await a1.flushAlertsIfNeeded();
    expect(sentTexts().filter(t => t.includes('[P2')).length).toBe(1);
    await a1.raise('P2', 'e2', '第二批');

    const a2 = await bootAlerting();
    await a2.flushAlertsIfNeeded();
    // 距上次 P2 flush 不足 24h：不发，但缓冲里仍保留第二批
    expect(sentTexts().filter(t => t.includes('[P2')).length).toBe(1);
    expect(a2.getStatus().p2_pending).toBe(1);
    expect(a2.getStatus().last_p2_flush).not.toBeNull();
  });

  it('持久化失败时 raise 不抛，降级为仅内存并 console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queryMock.mockRejectedValue(new Error('db down'));
    try {
      const a1 = await bootAlerting();
      await expect(a1.raise('P2', 'e1', '库挂了也要进缓冲')).resolves.toBeUndefined();
      expect(a1.getStatus().p2_pending).toBe(1);
      expect(warnSpy).toHaveBeenCalled();

      // 内存缓冲照常 flush
      await a1.flushP2();
      expect(sentTexts().some(t => t.includes('库挂了也要进缓冲'))).toBe(true);
    } finally {
      queryMock.mockReset();
      queryMock.mockImplementation(async (sql, params = []) => {
        if (/^\s*SELECT/i.test(sql)) {
          const v = store.get(params[0]);
          return { rows: v === undefined ? [] : [{ value_json: JSON.parse(JSON.stringify(v)) }] };
        }
        if (/^\s*INSERT/i.test(sql)) {
          const val = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
          store.set(params[0], JSON.parse(JSON.stringify(val)));
        }
        return { rows: [] };
      });
      warnSpy.mockRestore();
    }
  });

  it('恢复失败时不覆盖库里已有的未发缓冲', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a1 = await bootAlerting();
    await a1.raise('P2', 'e1', '库里的旧告警');

    const a2 = await bootAlerting();
    queryMock.mockRejectedValueOnce(new Error('db blip'));
    await a2.raise('P2', 'e2', '恢复失败期间的新告警');

    // 库恢复后下一次使用补齐恢复，旧告警不丢
    await a2.flushP2();
    expect(sentTexts()[0]).toContain('库里的旧告警');
    expect(sentTexts()[0]).toContain('恢复失败期间的新告警');
    warnSpy.mockRestore();
  });

  it('P0 行为不变：立即推送、同 eventType 5 分钟限流、不写库', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P0', 'circuit_open', '熔断 1');
    await a1.raise('P0', 'circuit_open', '熔断 2');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toContain('[P0] 熔断 1');
    expect(digestMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(c => /^\s*INSERT/i.test(c[0]))).toBe(false);
  });
});
