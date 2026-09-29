/**
 * Test: recurring.js — Recurring Tasks Engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchesCron, calculateNextRunAt, checkRecurringTasks } from '../recurring.js';

const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

describe('recurring tasks', () => {
  describe('matchesCron', () => {
    it('should match wildcard (* * * * *) for any date', () => {
      expect(matchesCron('* * * * *', new Date(2026, 1, 15, 9, 30))).toBe(true);
    });

    it('should match exact minute and hour', () => {
      // 0 9 * * * = every day at 9:00
      const date = new Date(2026, 1, 15, 9, 0);
      expect(matchesCron('0 9 * * *', date)).toBe(true);
    });

    it('should not match wrong minute', () => {
      const date = new Date(2026, 1, 15, 9, 30);
      expect(matchesCron('0 9 * * *', date)).toBe(false);
    });

    it('should not match wrong hour', () => {
      const date = new Date(2026, 1, 15, 10, 0);
      expect(matchesCron('0 9 * * *', date)).toBe(false);
    });

    it('should match day-of-week (Monday = 1)', () => {
      // 0 9 * * 1 = every Monday at 9:00
      // Feb 16, 2026 is Monday
      const monday = new Date(2026, 1, 16, 9, 0);
      expect(matchesCron('0 9 * * 1', monday)).toBe(true);

      // Feb 15, 2026 is Sunday
      const sunday = new Date(2026, 1, 15, 9, 0);
      expect(matchesCron('0 9 * * 1', sunday)).toBe(false);
    });

    it('should match day-of-week range (1-5 = weekdays)', () => {
      // 30 14 * * 1-5 = weekdays at 2:30 PM
      const monday = new Date(2026, 1, 16, 14, 30);
      expect(matchesCron('30 14 * * 1-5', monday)).toBe(true);

      // Sunday
      const sunday = new Date(2026, 1, 15, 14, 30);
      expect(matchesCron('30 14 * * 1-5', sunday)).toBe(false);
    });

    it('should match step expressions (*/5)', () => {
      // */5 * * * * = every 5 minutes
      expect(matchesCron('*/5 * * * *', new Date(2026, 1, 15, 9, 0))).toBe(true);
      expect(matchesCron('*/5 * * * *', new Date(2026, 1, 15, 9, 5))).toBe(true);
      expect(matchesCron('*/5 * * * *', new Date(2026, 1, 15, 9, 10))).toBe(true);
      expect(matchesCron('*/5 * * * *', new Date(2026, 1, 15, 9, 3))).toBe(false);
    });

    it('should match comma-separated values', () => {
      // 0 9,17 * * * = at 9:00 and 17:00
      expect(matchesCron('0 9,17 * * *', new Date(2026, 1, 15, 9, 0))).toBe(true);
      expect(matchesCron('0 9,17 * * *', new Date(2026, 1, 15, 17, 0))).toBe(true);
      expect(matchesCron('0 9,17 * * *', new Date(2026, 1, 15, 10, 0))).toBe(false);
    });

    it('should match specific day-of-month', () => {
      // 0 9 1 * * = 1st of every month at 9:00
      expect(matchesCron('0 9 1 * *', new Date(2026, 1, 1, 9, 0))).toBe(true);
      expect(matchesCron('0 9 1 * *', new Date(2026, 1, 15, 9, 0))).toBe(false);
    });

    it('should match specific month', () => {
      // 0 9 * 2 * = every day in February at 9:00
      expect(matchesCron('0 9 * 2 *', new Date(2026, 1, 15, 9, 0))).toBe(true);  // Feb
      expect(matchesCron('0 9 * 2 *', new Date(2026, 2, 15, 9, 0))).toBe(false);  // Mar
    });

    it('should return false for invalid expressions', () => {
      expect(matchesCron('', new Date())).toBe(false);
      expect(matchesCron(null, new Date())).toBe(false);
      expect(matchesCron('invalid', new Date())).toBe(false);
      expect(matchesCron('* * *', new Date())).toBe(false); // only 3 fields
    });
  });

  // 2026-09 定时引擎复活（任务 3d0db274）：下一次运行时间一律按模板时区（默认 Asia/Shanghai）算，
  // 不再按服务器本地时区；daily/weekly 都按 cron_expression 解释。用 UTC ISO 断言，与机器时区无关。
  describe('calculateNextRunAt（北京时区）', () => {
    it('daily：北京 18:00 之后的 09:00 是次日北京 09:00（UTC 01:00）', () => {
      const result = calculateNextRunAt({ recurrence_type: 'daily', cron_expression: '0 9 * * *' }, new Date('2026-02-15T10:00:00Z'));
      expect(result.toISOString()).toBe('2026-02-16T01:00:00.000Z');
    });

    it('weekly：按 cron 的星期字段走（北京周一 09:00）', () => {
      // 2026-02-15 是周日
      const result = calculateNextRunAt({ recurrence_type: 'weekly', cron_expression: '0 9 * * 1' }, new Date('2026-02-15T10:00:00Z'));
      expect(result.toISOString()).toBe('2026-02-16T01:00:00.000Z');
    });

    it('interval：cron_expression 存分钟数', () => {
      const now = new Date('2026-02-15T10:00:00Z');
      const result = calculateNextRunAt({ recurrence_type: 'interval', cron_expression: '60' }, now);
      expect(result.getTime() - now.getTime()).toBe(60 * 60 * 1000);
    });

    it('cron：北京 10:00 = UTC 02:00', () => {
      const result = calculateNextRunAt({ recurrence_type: 'cron', cron_expression: '0 10 * * *' }, new Date('2026-02-15T01:00:00Z'));
      expect(result.toISOString()).toBe('2026-02-15T02:00:00.000Z');
    });

    it('非法 interval 返回 null', () => {
      expect(calculateNextRunAt({ recurrence_type: 'interval', cron_expression: 'invalid' })).toBeNull();
    });
  });

  // 引擎行为（到点 / 基线 / 迟到 / CAS / 叠单 / 透传 / 过期）见 recurring-engine.test.js；
  // 这里只保留旧入口 checkRecurringTasks 的最小回归：空表不出单、不抛错。
  describe('checkRecurringTasks', () => {
    it('should handle empty recurring tasks', async () => {
      const pool = (await import('../db.js')).default;
      pool.query.mockReset();
      pool.query.mockResolvedValue({ rows: [] });
      const result = await checkRecurringTasks(new Date());
      expect(result).toHaveLength(0);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });
});
