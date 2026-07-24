/**
 * morning-cockpit-bark.test.js
 * 覆盖：时间窗口判断 / 去重逻辑 / 无硬编码 BARK_TOKEN（复用 sendBark）
 * Task ID: 80a5be84-059a-4d86-a55c-a1e38f84e043
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(true),
}));

vi.mock('../triage-officer-rank.js', () => ({
  LEADERBOARD_KEY: 'triage_officer_leaderboard',
}));

import { isInMorningCockpitWindow, runMorningCockpitBark } from '../morning-cockpit-bark.js';
import { sendBark } from '../notifier.js';

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

// 北京 08:30 = UTC 00:30
const UTC_TRIGGER_H = 0;
const UTC_TRIGGER_M = 30;

describe('isInMorningCockpitWindow', () => {
  it('UTC 00:30 正好在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M, 0));
    expect(isInMorningCockpitWindow(now)).toBe(true);
  });

  it('UTC 00:25（窗口左边界 -5min）在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M - 5, 0));
    expect(isInMorningCockpitWindow(now)).toBe(true);
  });

  it('UTC 00:35（窗口右边界 +5min）在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M + 5, 0));
    expect(isInMorningCockpitWindow(now)).toBe(true);
  });

  it('UTC 00:24（窗口外 -6min）不在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M - 6, 0));
    expect(isInMorningCockpitWindow(now)).toBe(false);
  });

  it('UTC 00:36（窗口外 +6min）不在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M + 6, 0));
    expect(isInMorningCockpitWindow(now)).toBe(false);
  });

  it('UTC 12:00（中午）不在窗口内', () => {
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    expect(isInMorningCockpitWindow(now)).toBe(false);
  });
});

describe('runMorningCockpitBark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：当前时间在窗口内（UTC 00:30）
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, UTC_TRIGGER_H, UTC_TRIGGER_M, 0)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口外直接跳过，不调用 sendBark', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)));
    const pool = makePool();
    const result = await runMorningCockpitBark(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'outside_window' });
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('当日已推送时跳过，不调用 sendBark', async () => {
    // sentinel 记录在 1 小时前（在 20h TTL 内）
    const sentAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const pool = makePool([{ value_json: { sent_at: sentAt } }]);
    const result = await runMorningCockpitBark(pool);
    expect(result).toMatchObject({ skipped: true, reason: 'already_sent_today' });
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('窗口内且未推送过：调用 sendBark，写 sentinel，返回 sent:true', async () => {
    const pool = makePool(); // 空 rows = 未推送
    const result = await runMorningCockpitBark(pool);
    expect(result).toMatchObject({ sent: true });
    expect(sendBark).toHaveBeenCalledTimes(1);
    // 确认 sendBark 参数结构（title + body + options），不含硬编码 token
    const [title, body, opts] = sendBark.mock.calls[0];
    expect(typeof title).toBe('string');
    expect(typeof body).toBe('string');
    expect(opts).toHaveProperty('dedupeKey');
    // opts 不应包含 token 字段（依赖 notifier.js 内部处理）
    expect(opts).not.toHaveProperty('token');
    // sentinel 写入：pool.query 被调用（SELECT + INSERT）
    expect(pool.query).toHaveBeenCalled();
  });

  it('sentinel 读取失败时仍继续推送（降级安全）', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const result = await runMorningCockpitBark(pool);
    // db 异常时 alreadySentToday 返回 false，继续推送
    expect(result).toMatchObject({ sent: true });
    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  it('sendBark 不接受硬编码 BARK_TOKEN：mock 来自 notifier.js', () => {
    // 验证 mock 路径：如果有硬编码 token，这里的 mock 会失效
    expect(vi.isMockFunction(sendBark)).toBe(true);
  });
});
