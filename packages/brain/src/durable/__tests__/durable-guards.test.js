/**
 * C2 测试：durable 路径必须保留触发窗口 + 今日去重守卫（对齐原 generateDailyReport）。
 *
 * 原 generateDailyReport 先 isInReportTriggerWindow(UTC01:00±5min) + hasTodayReport(去重) 才干活。
 * durable 版若丢守卫 → flag 开每 tick(~5min) 发一次飞书。本测试锁守卫行为：
 *   - 窗口外 → {generated:false, skipped_window:true}，不调 workflow（不发飞书）
 *   - 今日已有报告 → {generated:false, skipped_dup:true}，不调 workflow
 *   - 窗口内且未生成 → 调 workflow，返回 {generated:true}
 *
 * 用依赖注入（_runWorkflow / _hasTodayReport）避免真 DBOS/DB。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { durableDailyReport } from '../daily-report-durable.js';

afterEach(() => vi.restoreAllMocks());

const pool = { fake: 'pool' };

describe('durableDailyReport 触发窗口 + 去重守卫（C2）', () => {
  it('窗口外（UTC 03:00）→ skipped_window，不调 workflow', async () => {
    const runWorkflow = vi.fn().mockResolvedValue({ generated: true, date: '2026-06-21' });
    const hasReport = vi.fn().mockResolvedValue(false);
    const now = new Date('2026-06-21T03:00:00Z');
    const res = await durableDailyReport(pool, now, { _runWorkflow: runWorkflow, _hasTodayReport: hasReport });
    expect(res.generated).toBe(false);
    expect(res.skipped_window).toBe(true);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('今日已有报告 → skipped_dup，不调 workflow', async () => {
    const runWorkflow = vi.fn().mockResolvedValue({ generated: true, date: '2026-06-21' });
    const hasReport = vi.fn().mockResolvedValue(true); // 已生成
    const now = new Date('2026-06-21T01:02:00Z'); // 窗口内
    const res = await durableDailyReport(pool, now, { _runWorkflow: runWorkflow, _hasTodayReport: hasReport });
    expect(res.generated).toBe(false);
    expect(res.skipped_dup).toBe(true);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('窗口内且未生成 → 调 workflow，generated:true', async () => {
    const runWorkflow = vi.fn().mockResolvedValue({ generated: true, date: '2026-06-21' });
    const hasReport = vi.fn().mockResolvedValue(false);
    const now = new Date('2026-06-21T01:00:00Z');
    const res = await durableDailyReport(pool, now, { _runWorkflow: runWorkflow, _hasTodayReport: hasReport });
    expect(res.generated).toBe(true);
    expect(runWorkflow).toHaveBeenCalledTimes(1);
    // workflow 收到 today/yesterday
    expect(runWorkflow).toHaveBeenCalledWith({ today: '2026-06-21', yesterday: '2026-06-20' });
  });
});
