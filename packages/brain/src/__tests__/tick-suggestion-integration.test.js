/**
 * Tests for suggestion integration with tick loop
 */

import { vi, describe, test, expect, beforeAll, beforeEach } from 'vitest';

// Mock suggestion-triage module
vi.mock('../suggestion-triage.js', () => ({
  executeTriage: vi.fn(),
  cleanupExpiredSuggestions: vi.fn()
}));

// Mock other dependencies to isolate tick logic
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

vi.mock('../alertness/index.js', () => ({
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 1, score: 0.3 }),
  ALERTNESS_LEVELS: { PANIC: 4, ALERT: 3 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC']
}));

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ actions: [{ type: 'fallback_to_tick' }] }),
  EVENT_TYPES: { TICK: 'tick' }
}));

// Mock other modules that are called during tick
vi.mock('../executor.js', () => ({
  cleanupOrphanProcesses: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  MAX_SEATS: 5,
  INTERACTIVE_RESERVE: 2
}));

vi.mock('../decision-executor.js', () => ({
  expireStaleProposals: vi.fn().mockResolvedValue(0)
}));

import pool from '../db.js';
import {
  executeTriage,
  cleanupExpiredSuggestions
} from '../suggestion-triage.js';
import { evaluateAlertness } from '../alertness/index.js';

describe('Tick Suggestion Integration', () => {
  let executeTick;
  let resetLastCleanupTime;

  beforeAll(async () => {
    // Import executeTick after mocks are set up
    const tickModule = await import('../tick.js');
    executeTick = tickModule.executeTick;
    resetLastCleanupTime = tickModule._resetLastCleanupTime;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 cleanup 计时器，确保每个测试从干净状态开始
    resetLastCleanupTime?.();

    // Default mock implementations
    pool.query.mockImplementation((query) => {
      if (query.includes('run_periodic_cleanup')) {
        return Promise.resolve({ rows: [{ msg: 'cleanup done' }] });
      }
      if (query.includes('UPDATE learnings')) {
        return Promise.resolve({ rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    // Mock suggestion triage functions
    executeTriage.mockResolvedValue([]);
    cleanupExpiredSuggestions.mockResolvedValue(0);
  });

  describe('Suggestion processing in tick loop', () => {
    test('executes triage on every tick', async () => {
      await executeTick();

      expect(executeTriage).toHaveBeenCalledWith(20);
      expect(executeTriage).toHaveBeenCalledTimes(1);
    });

    test('includes triage results in actions_taken when suggestions processed', async () => {
      const mockProcessedSuggestions = [
        { id: '1', priority_score: 0.9 },
        { id: '2', priority_score: 0.8 }
      ];

      executeTriage.mockResolvedValue(mockProcessedSuggestions);

      const result = await executeTick();

      expect(result.success).toBe(true);
      expect(result.actions_taken).toContainEqual({
        action: 'suggestion_triage',
        processed_count: 2
      });
    });

    test('does not add action when no suggestions processed', async () => {
      executeTriage.mockResolvedValue([]);

      const result = await executeTick();

      expect(result.success).toBe(true);
      const suggestionActions = result.actions_taken.filter(
        action => action.action === 'suggestion_triage'
      );
      expect(suggestionActions).toHaveLength(0);
    });

    test('continues tick execution even if triage fails', async () => {
      executeTriage.mockRejectedValue(new Error('Triage failed'));

      const result = await executeTick();

      // Tick should still succeed despite triage failure
      expect(result.success).toBe(true);
      expect(executeTriage).toHaveBeenCalled();
    });

    test('executes cleanup during periodic maintenance', async () => {
      // beforeEach 已调用 _resetLastCleanupTime()，cleanup 必定触发
      cleanupExpiredSuggestions.mockResolvedValue(3);

      const result = await executeTick();

      expect(cleanupExpiredSuggestions).toHaveBeenCalled();
      expect(result.actions_taken).toContainEqual({
        action: 'suggestion_cleanup',
        cleanup_count: 3
      });
    });

    test('does not execute cleanup when interval not elapsed', async () => {
      // 先 tick 一次：触发 cleanup 并更新 _lastCleanupTime
      await executeTick();
      cleanupExpiredSuggestions.mockClear();

      // 立即再 tick：距上次不足 1 小时，cleanup 不应触发
      const result = await executeTick();

      expect(cleanupExpiredSuggestions).not.toHaveBeenCalled();
      const cleanupActions = result.actions_taken.filter(
        action => action.action === 'suggestion_cleanup'
      );
      expect(cleanupActions).toHaveLength(0);
    });
  });

  describe('Error handling and resilience', () => {
    test('handles triage errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executeTriage.mockRejectedValue(new Error('Database connection failed'));

      const result = await executeTick();

      expect(result.success).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[tick] Suggestion processing failed'),
        expect.stringContaining('Database connection failed')
      );

      consoleErrorSpy.mockRestore();
    });

    test('handles cleanup errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // beforeEach 已调用 _resetLastCleanupTime()，cleanup 必定触发
      cleanupExpiredSuggestions.mockRejectedValue(new Error('Cleanup failed'));

      const result = await executeTick();

      expect(result.success).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[tick] Suggestion processing failed'),
        expect.stringContaining('Cleanup failed')
      );

      consoleErrorSpy.mockRestore();
    });

    test('limits processing to prevent performance impact', async () => {
      // 确保我们限制处理的建议数量
      await executeTick();

      expect(executeTriage).toHaveBeenCalledWith(20); // 确认限制为20条
    });

    test('measures and logs processing time appropriately', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const mockProcessedSuggestions = [{ id: '1' }, { id: '2' }];
      executeTriage.mockResolvedValue(mockProcessedSuggestions);

      await executeTick();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[tick] Processed 2 suggestions in triage')
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('Integration with other tick operations', () => {
    test('runs suggestion processing alongside other periodic tasks', async () => {
      // Mock other periodic operations
      pool.query.mockImplementation((query) => {
        if (query.includes('run_periodic_cleanup')) {
          return Promise.resolve({ rows: [{ msg: 'cleanup done' }] });
        }
        if (query.includes('UPDATE learnings')) {
          return Promise.resolve({ rowCount: 2 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      executeTriage.mockResolvedValue([{ id: '1' }]);

      const result = await executeTick();

      expect(result.success).toBe(true);
      expect(executeTriage).toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('run_periodic_cleanup')
      );
    });

    test('suggestion processing does not interfere with alertness evaluation', async () => {
      executeTriage.mockResolvedValue([{ id: '1' }]);

      const result = await executeTick();

      expect(evaluateAlertness).toHaveBeenCalled();
      expect(executeTriage).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});
