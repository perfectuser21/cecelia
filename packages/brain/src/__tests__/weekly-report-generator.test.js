import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

import {
  isInWeeklyReportTriggerWindow,
  getISOWeekKey,
  getLastWeekRange,
  buildWeeklyReportText,
  generateWeeklyReport,
} from '../weekly-report-generator.js';

// ─── isInWeeklyReportTriggerWindow ───────────────────────────────────────────

describe('isInWeeklyReportTriggerWindow()', () => {
  it('周一 UTC 01:00 返回 true', () => {
    // 2026-04-06 是周一
    const now = new Date('2026-04-06T01:00:00Z');
    expect(isInWeeklyReportTriggerWindow(now)).toBe(true);
  });

  it('周一 UTC 01:04（窗口内）返回 true', () => {
    const now = new Date('2026-04-06T01:04:00Z');
    expect(isInWeeklyReportTriggerWindow(now)).toBe(true);
  });

  it('周一 UTC 01:05（窗口外）返回 false', () => {
    const now = new Date('2026-04-06T01:05:00Z');
    expect(isInWeeklyReportTriggerWindow(now)).toBe(false);
  });

  it('周二 UTC 01:00（非周一）返回 false', () => {
    const now = new Date('2026-04-07T01:00:00Z');
    expect(isInWeeklyReportTriggerWindow(now)).toBe(false);
  });

  it('周日 UTC 01:00（非周一）返回 false', () => {
    const now = new Date('2026-04-05T01:00:00Z');
    expect(isInWeeklyReportTriggerWindow(now)).toBe(false);
  });

  it('周一 UTC 09:00（非触发时间）返回 false', () => {
    const now = new Date('2026-04-06T09:00:00Z');
    expect(isInWeeklyReportTriggerWindow(now)).toBe(false);
  });
});

// ─── getISOWeekKey ────────────────────────────────────────────────────────────

describe('getISOWeekKey()', () => {
  it('2026-04-06（周一）→ 2026-W15', () => {
    const now = new Date('2026-04-06T01:00:00Z');
    expect(getISOWeekKey(now)).toBe('2026-W15');
  });

  it('2026-01-05（周一，第2周）→ 2026-W02', () => {
    const now = new Date('2026-01-05T01:00:00Z');
    expect(getISOWeekKey(now)).toBe('2026-W02');
  });
});

// ─── getLastWeekRange ─────────────────────────────────────────────────────────

describe('getLastWeekRange()', () => {
  it('周一 2026-04-06 → 上周 2026-03-30 ~ 2026-04-05', () => {
    const now = new Date('2026-04-06T01:00:00Z');
    const { startStr, endStr } = getLastWeekRange(now);
    expect(startStr).toBe('2026-03-30');
    expect(endStr).toBe('2026-04-05');
  });

  it('start < end（时序正确）', () => {
    const now = new Date('2026-04-06T01:00:00Z');
    const { start, end } = getLastWeekRange(now);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});

// ─── buildWeeklyReportText ────────────────────────────────────────────────────

describe('buildWeeklyReportText()', () => {
  const weekKey = '2026-W15';
  const startStr = '2026-03-30';
  const endStr = '2026-04-05';

  it('生成周报包含标题和统计范围', () => {
    const text = buildWeeklyReportText(weekKey, startStr, endStr, { count: 0, topics: [] }, [], [], 0);
    expect(text).toContain('ZenithJoy 内容周报 2026-W15');
    expect(text).toContain('2026-03-30 ~ 2026-04-05');
  });

  it('有发布数据时展示合计', () => {
    const publishStats = [
      { platform: 'douyin', success: 3, failed: 1 },
      { platform: 'kuaishou', success: 2, failed: 0 },
    ];
    const text = buildWeeklyReportText(weekKey, startStr, endStr, { count: 5, topics: ['内容运营'] }, publishStats, [], 1);
    expect(text).toContain('全平台合计：成功 5 / 失败 1');
    expect(text).toContain('douyin');
    expect(text).toContain('失败 1 次，请关注');
  });

  it('有数据回收时展示阅读量', () => {
    const engagementData = [
      { platform: 'douyin', views: 10000, likes: 500, comments: 20, shares: 10 },
    ];
    const text = buildWeeklyReportText(weekKey, startStr, endStr, { count: 0, topics: [] }, [], engagementData, 0);
    expect(text).toContain('全平台合计：阅读');
    expect(text).toContain('douyin');
  });

  it('无数据时展示空态文案', () => {
    const text = buildWeeklyReportText(weekKey, startStr, endStr, { count: 0, topics: [] }, [], [], 0);
    expect(text).toContain('本周无 content-pipeline 完成任务');
    expect(text).toContain('本周无发布任务');
    expect(text).toContain('本周无数据回收记录');
    expect(text).toContain('无发布失败记录');
  });
});

// ─── generateWeeklyReport ─────────────────────────────────────────────────────

describe('generateWeeklyReport()', () => {
  it('窗口外调用返回 skipped_window: true', async () => {
    const now = new Date('2026-04-06T09:00:00Z'); // 非触发时间
    const result = await generateWeeklyReport({}, now);
    expect(result.skipped_window).toBe(true);
    expect(result.generated).toBe(false);
  });

  it('窗口内但已生成时返回 skipped_dup: true', async () => {
    const now = new Date('2026-04-06T01:00:00Z'); // 周一 UTC 01:00
    // mock dbPool
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes('working_memory')) {
          return { rows: [{ value_json: '{}' }] }; // 已存在
        }
        return { rows: [] };
      }),
    };
    const result = await generateWeeklyReport(mockPool, now);
    expect(result.skipped_dup).toBe(true);
    expect(result.generated).toBe(false);
  });

  it('窗口内且未生成时正常生成', async () => {
    const now = new Date('2026-04-06T01:00:00Z');
    let wmCallCount = 0;
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes('working_memory') && sql.includes('SELECT')) {
          wmCallCount++;
          return { rows: [] }; // 未生成过
        }
        if (sql.includes('INSERT INTO working_memory')) {
          return { rows: [] };
        }
        // 各数据查询返回空
        return { rows: [{ cnt: 0, topics: null, views: 0, likes: 0, comments: 0, shares: 0 }] };
      }),
    };
    const result = await generateWeeklyReport(mockPool, now);
    expect(result.generated).toBe(true);
    expect(result.week).toBe('2026-W15');
  });
});
