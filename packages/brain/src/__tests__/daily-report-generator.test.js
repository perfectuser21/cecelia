import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

import * as dailyReport from '../daily-report-generator.js';
import { isInReportTriggerWindow } from '../daily-report-generator.js';

describe('daily-report-generator', () => {
  describe('step 函数导出（durable 复用基础）', () => {
    const stepFns = [
      'hasTodayReport',
      'markTodayDone',
      'fetchYesterdayContentOutput',
      'fetchYesterdayPublishStats',
      'fetchYesterdayEngagementData',
      'fetchYesterdayFailureCount',
      'buildReportText',
      'saveReportToWorkingMemory',
      'getYesterdayString',
    ];
    for (const fn of stepFns) {
      it(`导出 ${fn}`, () => {
        expect(typeof dailyReport[fn]).toBe('function');
      });
    }
  });

  describe('isInReportTriggerWindow()', () => {
    it('UTC 01:00 返回 true', () => {
      const now = new Date('2026-03-30T01:00:00Z');
      expect(isInReportTriggerWindow(now)).toBe(true);
    });

    it('UTC 01:04 （窗口内）返回 true', () => {
      const now = new Date('2026-03-30T01:04:00Z');
      expect(isInReportTriggerWindow(now)).toBe(true);
    });

    it('UTC 01:05 （窗口外）返回 false', () => {
      const now = new Date('2026-03-30T01:05:00Z');
      expect(isInReportTriggerWindow(now)).toBe(false);
    });

    it('UTC 09:00 不是触发时间，返回 false', () => {
      const now = new Date('2026-03-30T09:00:00Z');
      expect(isInReportTriggerWindow(now)).toBe(false);
    });

    it('UTC 03:00 不是触发时间，返回 false', () => {
      const now = new Date('2026-03-30T03:00:00Z');
      expect(isInReportTriggerWindow(now)).toBe(false);
    });
  });

  // ─── 业务断言红灯板块（链 bf5088a3 棒4 消费，决策 702949b6）───────────────────
  describe('业务断言红灯板块', () => {
    const empty = [ '2026-09-26', '2026-09-25', { count: 0, keywords: [] }, [], [], 0, null, null, null, null ];
    const state = {
      level: 'RED', total: 4, window_hours: 24,
      groups: [
        { journey: '客户智能获客路径', step: 'Lead 表进人', probe_key: 'videos_readback', fail_count: 3, severity: 'error', last_at: null },
        { journey: '客户智能获客路径', step: 'Lead 表进人', probe_key: 'line_key_not_null', fail_count: 1, severity: 'warn', last_at: null },
      ],
    };

    it('导出 renderAssertionRedSection（与 renderBareRunSection 并列）', () => {
      expect(typeof dailyReport.renderAssertionRedSection).toBe('function');
      expect(dailyReport.renderAssertionRedSection(state)).toContain('== 业务断言红灯（24h）==');
    });

    it('buildReportText 尾参传 state → 出板块，含 RED 汇总与每组一行', () => {
      const text = dailyReport.buildReportText(...empty, state);
      expect(text).toContain('== 业务断言红灯（24h）==');
      expect(text).toContain('🔴 RED 共 4 次 FAIL（含 error 级）');
      expect(text).toContain('  - 🔴 客户智能获客路径 / Lead 表进人 · videos_readback ×3（error）');
    });

    it('空集（null）→ 不出板块', () => {
      expect(dailyReport.buildReportText(...empty)).not.toContain('业务断言红灯');
      expect(dailyReport.buildReportText(...empty, null)).not.toContain('业务断言红灯');
    });

    it('generateDailyReport 主流程：回执表有 FAIL → 落库日报含板块；回执查询失败 → 仍生成不含板块', async () => {
      const saved = [];
      const mkPool = (receipts) => ({
        query: vi.fn(async (sql, params) => {
          if (/FROM journey_assertion_receipts/.test(String(sql))) {
            if (receipts instanceof Error) throw receipts;
            return { rows: receipts };
          }
          if (/INSERT INTO working_memory/.test(String(sql)) && String(params?.[0]).startsWith('daily_report_2')) {
            saved.push(JSON.parse(params[1]).report);
          }
          return { rows: [] };
        }),
      });
      const now = new Date('2026-09-26T01:00:00Z');
      const ok = await dailyReport.generateDailyReport(mkPool([
        { journey: 'J', step: 'S', assertion_ref: 'probe:k', fail_count: 2, has_error: true },
      ]), now);
      expect(ok.generated).toBe(true);
      expect(saved[0]).toContain('🔴 RED 共 2 次 FAIL');
      expect(saved[0]).toContain('J / S · k ×2（error）');

      const degraded = await dailyReport.generateDailyReport(mkPool(new Error('relation does not exist')), now);
      expect(degraded.generated).toBe(true);
      expect(saved[1]).not.toContain('业务断言红灯');
    });
  });
});
