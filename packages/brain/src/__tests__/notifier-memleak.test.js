import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 只隔离发送与回执边界，限流、过期清理和容量淘汰使用真实 notifier。
vi.mock('../muted-guard.js', () => ({ isMuted: () => false }));
vi.mock('../receipt-collector.js', () => ({
  recordActionReceipt: vi.fn(async () => null),
  resolveActionReceipt: vi.fn(async () => {}),
}));

describe('通知限流缓存的实际发送行为', () => {
  let notify, fetchSpy;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubEnv('FEISHU_BOT_WEBHOOK', 'https://notifications.invalid/webhook');
    for (const name of ['BARK_TOKEN', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_OWNER_OPEN_IDS']) {
      vi.stubEnv(name, '');
    }
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    ({ notifyTaskCompleted: notify } = await import('../notifier.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const event = task_id => ({ task_id, title: '已完成的任务' });

  it('同一任务在60秒内不重复发送，到期后可以再次发送', async () => {
    expect(await notify(event('same'))).toBe(true);
    vi.advanceTimersByTime(59_999);
    expect(await notify(event('same'))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(await notify(event('same'))).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      msg_type: 'text', content: { text: '✅ 任务完成：已完成的任务' },
    });
  });

  it('达到1000个不同任务时释放旧缓存，后续事件仍能发送', async () => {
    for (let n = 0; n < 1000; n++) expect(await notify(event(`task-${n}`))).toBe(true);
    expect(await notify(event('task-0'))).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1001);
    expect(await notify(event('task-0'))).toBe(false);
  });

  it('先清理过期项，不能因旧缓存占满而误淘汰仍在限流窗口内的任务', async () => {
    for (let n = 0; n < 999; n++) await notify(event(`expired-${n}`));
    vi.advanceTimersByTime(59_000);
    expect(await notify(event('fresh'))).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(await notify(event('new'))).toBe(true);
    expect(await notify(event('fresh'))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1001);
  });
});
