/**
 * Regression test for notifier._lastSent memory leak.
 *
 * Bug: 每次 sendRateLimited() 用 task_id/pr_key 拼的 key 做限流记录，
 *      但 Map 只 set 不 delete，UUID 累积到几万条永不释放 → Brain RSS 泄漏。
 *
 * Fix: sendRateLimited() 内部做 TTL-based pruning + hard cap fallback。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Notifier memory leak — _lastSent pruning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockFetch.mockReset();
    delete process.env.FEISHU_BOT_WEBHOOK;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_OWNER_OPEN_IDS;
  });

  async function load() {
    process.env.FEISHU_BOT_WEBHOOK = 'https://webhook.test';
    return import('../notifier.js');
  }

  it('过期 entry 在下次 sendRateLimited 前被清理（TTL-based GC）', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const mod = await load();
    const { notifyTaskCompleted, _lastSentSize, RATE_LIMIT_MS } = mod;

    // 模拟 100 个独立 task_id 写入（UUID 级别的高基数 key）
    const baseTs = 1_700_000_000_000;
    vi.setSystemTime(baseTs);
    for (let i = 0; i < 100; i++) {
      await notifyTaskCompleted({ task_id: `task-uuid-${i}`, title: `T${i}` });
    }
    expect(_lastSentSize()).toBe(100);

    // 时间前进超过 RATE_LIMIT_MS，下一次写入前应自动清空过期 entry
    vi.setSystemTime(baseTs + RATE_LIMIT_MS + 1);
    await notifyTaskCompleted({ task_id: 'task-uuid-FRESH', title: 'fresh' });

    // 清过期后只留新写入的 1 个
    expect(_lastSentSize()).toBe(1);

    vi.useRealTimers();
  });

  it('TTL 尚未过期时不会误删仍在限流窗口内的 entry', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const mod = await load();
    const { notifyTaskCompleted, _lastSentSize, RATE_LIMIT_MS } = mod;

    const baseTs = 1_700_000_000_000;
    vi.setSystemTime(baseTs);
    for (let i = 0; i < 10; i++) {
      await notifyTaskCompleted({ task_id: `task-${i}`, title: `T${i}` });
    }
    expect(_lastSentSize()).toBe(10);

    // 只前进一半窗口 → entry 都还有效
    vi.setSystemTime(baseTs + Math.floor(RATE_LIMIT_MS / 2));
    await notifyTaskCompleted({ task_id: 'task-new', title: 'new' });

    expect(_lastSentSize()).toBe(11);

    vi.useRealTimers();
  });

  it('超过 _MAX_ENTRIES 硬上限时整表清空（兜底保护）', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const mod = await load();
    const { notifyTaskCompleted, _lastSentSize, _MAX_ENTRIES, RATE_LIMIT_MS } = mod;

    expect(_MAX_ENTRIES).toBeGreaterThan(0);

    // 全部在同一时刻写入，pruneExpired 不会清（时间差为 0）
    const baseTs = 1_700_000_000_000;
    vi.setSystemTime(baseTs);
    for (let i = 0; i < _MAX_ENTRIES; i++) {
      await notifyTaskCompleted({ task_id: `hot-${i}`, title: `T${i}` });
    }
    expect(_lastSentSize()).toBe(_MAX_ENTRIES);

    // 下一次写入：size >= _MAX_ENTRIES 触发 clear，然后写入新 entry
    await notifyTaskCompleted({ task_id: 'overflow', title: 'ov' });
    expect(_lastSentSize()).toBe(1);

    // 保证 RATE_LIMIT 行为未被破坏：相同 key 60s 内被跳过
    const before = mockFetch.mock.calls.length;
    await notifyTaskCompleted({ task_id: 'overflow', title: 'ov2' });
    expect(mockFetch.mock.calls.length).toBe(before); // 没再发
    expect(_lastSentSize()).toBe(1);

    // 前进 > RATE_LIMIT 再发，应该放行
    vi.setSystemTime(baseTs + RATE_LIMIT_MS + 1);
    await notifyTaskCompleted({ task_id: 'overflow', title: 'ov3' });
    expect(mockFetch.mock.calls.length).toBe(before + 1);

    vi.useRealTimers();
  });

  it('原有 60s 限流语义保持不变（同 key 在窗口内只发一次）', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const mod = await load();
    const { notifyTaskCompleted, RATE_LIMIT_MS } = mod;

    const baseTs = 1_700_000_000_000;
    vi.setSystemTime(baseTs);
    const task = { task_id: 'same-task', title: 'same' };
    const r1 = await notifyTaskCompleted(task);
    const r2 = await notifyTaskCompleted(task);
    expect(r1).toBe(true);
    expect(r2).toBe(false); // 被限流

    // 窗口外放行
    vi.setSystemTime(baseTs + RATE_LIMIT_MS + 1);
    const r3 = await notifyTaskCompleted(task);
    expect(r3).toBe(true);

    vi.useRealTimers();
  });
});
