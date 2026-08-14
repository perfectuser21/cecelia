import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isInDailyScrapeWindow, scheduleDailyScrape, SCRAPE_PLATFORMS } from '../daily-scrape-scheduler.js';

describe('isInDailyScrapeWindow()', () => {
  it('UTC 20:00:00 — 在窗口内', () => {
    const d = new Date('2026-04-06T20:00:00Z');
    expect(isInDailyScrapeWindow(d)).toBe(true);
  });

  it('UTC 20:04:59 — 在窗口内', () => {
    const d = new Date('2026-04-06T20:04:59Z');
    expect(isInDailyScrapeWindow(d)).toBe(true);
  });

  it('UTC 20:05:00 — 超出窗口', () => {
    const d = new Date('2026-04-06T20:05:00Z');
    expect(isInDailyScrapeWindow(d)).toBe(false);
  });

  it('UTC 12:00:00 — 不在触发时间', () => {
    const d = new Date('2026-04-06T12:00:00Z');
    expect(isInDailyScrapeWindow(d)).toBe(false);
  });
});

describe('SCRAPE_PLATFORMS', () => {
  it('包含所有8个平台', () => {
    expect(SCRAPE_PLATFORMS).toHaveLength(8);
    expect(SCRAPE_PLATFORMS).toContain('douyin');
    expect(SCRAPE_PLATFORMS).toContain('kuaishou');
    expect(SCRAPE_PLATFORMS).toContain('xiaohongshu');
    expect(SCRAPE_PLATFORMS).toContain('toutiao');
    expect(SCRAPE_PLATFORMS).toContain('weibo');
    expect(SCRAPE_PLATFORMS).toContain('channels');
    expect(SCRAPE_PLATFORMS).toContain('gongzhonghao');
  });
});

describe('scheduleDailyScrape()', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    };
  });

  it('不在时间窗口且非 force — 直接返回 scheduled=0', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-06T12:00:00Z'));

    const result = await scheduleDailyScrape(mockPool);
    expect(result.scheduled).toBe(0);
    expect(result.inWindow).toBe(false);
    expect(mockPool.query).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('force=true — 为未调度过的平台创建任务', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const taskCreator = vi.fn(async ({ source_id }) => ({ task: { id: source_id } }));

    const result = await scheduleDailyScrape(mockPool, { force: true, taskCreator });
    expect(typeof result.scheduled).toBe('number');
    expect(typeof result.skipped).toBe('number');
    expect(result.scheduled + result.skipped).toBe(SCRAPE_PLATFORMS.length);
    expect(taskCreator).toHaveBeenCalledTimes(SCRAPE_PLATFORMS.length);
  });

  it('force=true — 已调度过的平台被跳过', async () => {
    // 所有平台都已调度
    mockPool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const result = await scheduleDailyScrape(mockPool, { force: true });
    expect(result.scheduled).toBe(0);
    expect(result.skipped).toBe(SCRAPE_PLATFORMS.length);
  });
});
