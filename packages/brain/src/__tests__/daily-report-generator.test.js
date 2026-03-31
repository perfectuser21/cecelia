import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

import { isInReportTriggerWindow } from '../daily-report-generator.js';

describe('daily-report-generator', () => {
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
