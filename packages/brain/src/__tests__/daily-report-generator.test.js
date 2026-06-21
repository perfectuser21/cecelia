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
});
