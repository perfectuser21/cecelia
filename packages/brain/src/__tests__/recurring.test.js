/**
 * Test: recurring.js — Recurring Tasks Engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchesCron, calculateNextRunAt, checkRecurringTasks } from '../recurring.js';

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

  describe('calculateNextRunAt', () => {
    it('should calculate next run for daily recurrence', () => {
      const now = new Date(2026, 1, 15, 10, 0);
      const result = calculateNextRunAt({
        recurrence_type: 'daily',
        cron_expression: '0 9 * * *'
      }, now);

      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(16);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(0);
    });

    it('should calculate next run for weekly recurrence', () => {
      const now = new Date(2026, 1, 15, 10, 0);
      const result = calculateNextRunAt({
        recurrence_type: 'weekly',
        cron_expression: '0 9 * * *'
      }, now);

      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(22); // 7 days later
    });

    it('should calculate next run for interval recurrence', () => {
      const now = new Date(2026, 1, 15, 10, 0);
      const result = calculateNextRunAt({
        recurrence_type: 'interval',
        cron_expression: '60'  // 60 minutes
      }, now);

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime() - now.getTime()).toBe(60 * 60 * 1000);
    });

    it('should calculate next run for cron recurrence', () => {
      const now = new Date(2026, 1, 15, 9, 0);
      const result = calculateNextRunAt({
        recurrence_type: 'cron',
        cron_expression: '0 10 * * *'
      }, now);

      expect(result).toBeInstanceOf(Date);
      expect(result.getHours()).toBe(10);
      expect(result.getMinutes()).toBe(0);
    });

    it('should return null for invalid interval', () => {
      const result = calculateNextRunAt({
        recurrence_type: 'interval',
        cron_expression: 'invalid'
      });
      expect(result).toBeNull();
    });
  });

  describe('checkRecurringTasks', () => {
    let pool;

    beforeEach(async () => {
      const dbModule = await import('../db.js');
      pool = dbModule.default;
      pool.query.mockReset();
    });

    it('should create task instance when recurring task is due', async () => {
      const now = new Date(2026, 1, 15, 9, 0);

      // Mock: get active recurring tasks
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'rt-1',
            title: 'Daily QA Check',
            description: 'Run daily QA',
            task_type: 'review',
            recurrence_type: 'daily',
            cron_expression: '0 9 * * *',
            is_active: true,
            goal_id: 'goal-1',
            project_id: 'proj-1',
            priority: 'P1',
            template: { task_type: 'review' },
            next_run_at: null,
            last_run_at: null
          }]
        })
        // Mock: check existing tasks (dedup)
        .mockResolvedValueOnce({ rows: [] })
        // Mock: insert task
        .mockResolvedValueOnce({
          rows: [{ id: 'task-new-1', title: 'Daily QA Check' }]
        })
        // Mock: update recurring task
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkRecurringTasks(now);

      expect(result).toHaveLength(1);
      expect(result[0].task_title).toBe('Daily QA Check');
      expect(result[0].recurring_task_id).toBe('rt-1');
    });

    it('should skip if task already exists (dedup)', async () => {
      const now = new Date(2026, 1, 15, 9, 0);

      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'rt-1',
            title: 'Daily QA Check',
            recurrence_type: 'daily',
            cron_expression: '0 9 * * *',
            is_active: true,
            template: {},
            next_run_at: null
          }]
        })
        // Mock: existing task found (dedup)
        .mockResolvedValueOnce({ rows: [{ id: 'existing-task' }] })
        // Mock: update next_run_at
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkRecurringTasks(now);

      expect(result).toHaveLength(0);
    });

    it('should handle empty recurring tasks', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await checkRecurringTasks(new Date());

      expect(result).toHaveLength(0);
    });

    it('should skip cron tasks that do not match current time', async () => {
      const now = new Date(2026, 1, 15, 10, 30); // 10:30, not 9:00

      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'rt-1',
          title: 'Morning Task',
          recurrence_type: 'cron',
          cron_expression: '0 9 * * *', // 9:00 AM
          is_active: true,
          template: {},
          next_run_at: null
        }]
      });

      const result = await checkRecurringTasks(now);

      expect(result).toHaveLength(0);
    });
  });
});
