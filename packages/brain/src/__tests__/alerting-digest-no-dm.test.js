/**
 * P1/P2 汇总不私信主理人回归测试（决策 d3e7746c：推给主理人的只要业务有用的，系统类不推）
 *
 * Bug：#5687 把 P1 每小时 / P2 每日汇总接回 scheduler 后，flush 调 sendFeishu；
 * 生产 FEISHU_BOT_WEBHOOK 为空 → sendFeishu 降级为 Open API 私信主理人，
 * 积压的系统类 P1（launchd_patrol_anomaly / guard_drill_no_fire 等）全部私信轰炸。
 * 修复：汇总只走专用系统通道 ALERT_DIGEST_WEBHOOK；未配置则只 console.log + 落库记录，
 * 均视为 flush 成功（清空缓冲、更新 last_flush）。P0 立即推送不变（仍走 sendFeishu）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store, queryMock, sendMock, fetchMock } = vi.hoisted(() => {
  const store = new Map();
  const queryMock = vi.fn(async (sql, params = []) => {
    if (/^\s*SELECT/i.test(sql)) {
      const v = store.get(params[0]);
      return { rows: v === undefined ? [] : [{ value_json: JSON.parse(JSON.stringify(v)) }] };
    }
    if (/^\s*INSERT/i.test(sql)) {
      store.set(params[0], JSON.parse(params[1]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  });
  const sendMock = vi.fn().mockResolvedValue(true);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  return { store, queryMock, sendMock, fetchMock };
});

vi.mock('../db.js', () => ({ default: { query: queryMock } }));
vi.mock('../notifier.js', () => ({ sendFeishu: sendMock }));

const DIGEST_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-digest';

async function bootAlerting() {
  vi.resetModules();
  return import('../alerting.js');
}

describe('P1/P2 汇总不私信主理人（决策 d3e7746c）', () => {
  let logSpy;
  const origFetch = global.fetch;

  beforeEach(() => {
    store.clear();
    queryMock.mockClear();
    sendMock.mockClear();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    delete process.env.ALERT_DIGEST_WEBHOOK;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = origFetch;
    delete process.env.ALERT_DIGEST_WEBHOOK;
    logSpy.mockRestore();
  });

  it('无 ALERT_DIGEST_WEBHOOK：flushP1 不调 sendFeishu、不发 webhook，缓冲清空并落库记录', async () => {
    const a = await bootAlerting();
    await a.raise('P1', 'launchd_patrol_anomaly', 'launchd 巡检异常');
    await a.raise('P1', 'guard_drill_no_fire', '守卫演练未触发');
    await a.flushP1();

    expect(sendMock).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(a.getStatus().p1_pending).toBe(0);
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('[P1 每小时汇总] 2'))).toBe(true);

    const st = a.getStatus();
    expect(st.last_p1_digest).toMatchObject({ count: 2, channel: 'log' });
    expect(st.last_p1_digest.items.map(i => i.eventType)).toEqual(['launchd_patrol_anomaly', 'guard_drill_no_fire']);
    expect(st.last_p1_flush).not.toBeNull();

    const saved = store.get('alerting_buffers');
    expect(saved.p1).toEqual([]);
    expect(saved.last_p1_digest.count).toBe(2);
  });

  it('无 ALERT_DIGEST_WEBHOOK：flushP2 同样不私信，缓冲清空', async () => {
    const a = await bootAlerting();
    await a.raise('P2', 'task_failed', '单次任务失败');
    await a.flushP2();

    expect(sendMock).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(a.getStatus().p2_pending).toBe(0);
    expect(a.getStatus().last_p2_digest).toMatchObject({ count: 1, channel: 'log' });
  });

  it('无 ALERT_DIGEST_WEBHOOK：flushAlertsIfNeeded 更新 last_flush 且不私信', async () => {
    const a = await bootAlerting();
    await a.raise('P1', 'e1', 'p1');
    await a.raise('P2', 'e2', 'p2');
    await a.flushAlertsIfNeeded();

    expect(sendMock).toHaveBeenCalledTimes(0);
    const st = a.getStatus();
    expect(st.p1_pending).toBe(0);
    expect(st.p2_pending).toBe(0);
    expect(st.last_p1_flush).not.toBeNull();
    expect(st.last_p2_flush).not.toBeNull();
  });

  it('落库的汇总记录重启后仍可查', async () => {
    const a1 = await bootAlerting();
    await a1.raise('P1', 'e1', '重启前汇总');
    await a1.flushP1();

    const a2 = await bootAlerting();
    await a2.flushP1(); // 触发恢复
    expect(a2.getStatus().last_p1_digest).toMatchObject({ count: 1, channel: 'log' });
  });

  it('配置 ALERT_DIGEST_WEBHOOK：只发该 webhook，不调 sendFeishu', async () => {
    process.env.ALERT_DIGEST_WEBHOOK = DIGEST_URL;
    const a = await bootAlerting();
    await a.raise('P1', 'e1', 'P1 系统告警');
    await a.flushP1();

    expect(sendMock).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DIGEST_URL);
    const body = JSON.parse(init.body);
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toContain('[P1 每小时汇总] 1');
    expect(body.content.text).toContain('P1 系统告警');
    expect(a.getStatus().p1_pending).toBe(0);
    expect(a.getStatus().last_p1_digest.channel).toBe('webhook');
  });

  it('webhook 发送失败：不抛、不回落私信，flush 仍视为成功', async () => {
    process.env.ALERT_DIGEST_WEBHOOK = DIGEST_URL;
    fetchMock.mockRejectedValue(new Error('network down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const a = await bootAlerting();
      await a.raise('P2', 'e1', 'x');
      await expect(a.flushP2()).resolves.toBeUndefined();
      expect(sendMock).toHaveBeenCalledTimes(0);
      expect(a.getStatus().p2_pending).toBe(0);
      expect(a.getStatus().last_p2_digest.channel).toBe('webhook_failed');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('P0 行为不变：仍立即调用 sendFeishu', async () => {
    const a = await bootAlerting();
    await a.raise('P0', 'circuit_open', '熔断');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toContain('[P0] 熔断');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
