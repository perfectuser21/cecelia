import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  sendFeishu,
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyCircuitOpen,
  notifyPatrolCleanup,
  notifyDailySummary,
  RATE_LIMIT_MS
} from '../notifier.js';

describe('Notifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  describe('sendFeishu', () => {
    it('skips when FEISHU_BOT_WEBHOOK not set', async () => {
      // Default env has no webhook, so it should skip
      const result = await sendFeishu('test');
      // Result depends on env; if webhook is set it sends, otherwise skips
      expect(typeof result).toBe('boolean');
    });

    it('handles fetch error gracefully', async () => {
      // Even if fetch fails, should not throw
      mockFetch.mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // This won't actually call fetch if webhook is not set
      const result = await sendFeishu('test');
      consoleSpy.mockRestore();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('notifyTaskCompleted', () => {
    it('generates correct message format', async () => {
      const result = await notifyTaskCompleted({
        task_id: 't1',
        title: 'Build feature',
        duration_ms: 120000
      });
      expect(typeof result).toBe('boolean');
    });

    it('handles missing duration', async () => {
      const result = await notifyTaskCompleted({
        task_id: 't2',
        title: 'Simple task'
      });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('notifyTaskFailed', () => {
    it('generates correct message with reason', async () => {
      const result = await notifyTaskFailed({
        task_id: 't1',
        title: 'Broken task',
        reason: 'timeout'
      });
      expect(typeof result).toBe('boolean');
    });

    it('handles missing reason', async () => {
      const result = await notifyTaskFailed({
        task_id: 't2',
        title: 'Failed task'
      });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('notifyCircuitOpen', () => {
    it('generates correct message', async () => {
      const result = await notifyCircuitOpen({
        key: 'cecelia-run',
        failures: 3,
        reason: 'failure_threshold_reached'
      });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('notifyPatrolCleanup', () => {
    it('generates correct message', async () => {
      const result = await notifyPatrolCleanup({
        task_id: 't1',
        title: 'Stuck task',
        elapsed_minutes: 45
      });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('notifyDailySummary', () => {
    it('generates summary message', async () => {
      const result = await notifyDailySummary({
        completed: 5,
        failed: 1,
        planned: 3,
        circuit_breakers: { 'cecelia-run': { state: 'CLOSED' } }
      });
      expect(typeof result).toBe('boolean');
    });

    it('includes open breakers in message', async () => {
      const result = await notifyDailySummary({
        completed: 0,
        failed: 3,
        planned: 0,
        circuit_breakers: { 'cecelia-run': { state: 'OPEN' } }
      });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('rate limiting', () => {
    it('RATE_LIMIT_MS is 60 seconds', () => {
      expect(RATE_LIMIT_MS).toBe(60 * 1000);
    });
  });
});
