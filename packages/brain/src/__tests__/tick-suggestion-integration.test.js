/**
 * Tests for suggestion integration with tick loop
 */

import { jest } from '@jest/globals';

// Mock suggestion-triage module
jest.unstable_mockModule('../suggestion-triage.js', () => ({
  executeTriage: jest.fn(),
  cleanupExpiredSuggestions: jest.fn()
}));

const {
  executeTriage,
  cleanupExpiredSuggestions
} = await import('../suggestion-triage.js');

// Mock other dependencies to isolate tick logic
jest.unstable_mockModule('../db.js', () => ({
  default: {
    query: jest.fn()
  }
}));

jest.unstable_mockModule('../alertness/index.js', () => ({
  evaluateAlertness: jest.fn().mockResolvedValue({ level: 1, score: 0.3 }),
  ALERTNESS_LEVELS: { PANIC: 4, ALERT: 3 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC']
}));

jest.unstable_mockModule('../thalamus.js', () => ({
  processEvent: jest.fn().mockResolvedValue({ actions: [{ type: 'fallback_to_tick' }] }),
  EVENT_TYPES: { TICK: 'tick' }
}));

// Mock other modules that are called during tick
jest.unstable_mockModule('../executor.js', () => ({
  cleanupOrphanProcesses: jest.fn(),
  syncOrphanTasksOnStartup: jest.fn(),
  getActiveProcessCount: jest.fn().mockReturnValue(0),
  MAX_SEATS: 5,
  INTERACTIVE_RESERVE: 2
}));

jest.unstable_mockModule('../decision-executor.js', () => ({
  expireStaleProposals: jest.fn().mockResolvedValue(0)
}));

const { default: pool } = await import('../db.js');

describe('Tick Suggestion Integration', () => {
  let executeTick;

  beforeAll(async () => {
    // Import executeTick after mocks are set up
    const tickModule = await import('../tick.js');
    executeTick = tickModule.executeTick;
  });

  beforeEach(() => {
    jest.clearAllMocks();

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
      // Mock cleanup interval elapsed (simulate 1+ hour passed)
      const mockDate = new Date();
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(mockDate.getTime() - (60 * 60 * 1000 + 1)) // _lastCleanupTime
        .mockReturnValueOnce(mockDate.getTime()); // current time

      cleanupExpiredSuggestions.mockResolvedValue(3);

      const result = await executeTick();

      expect(cleanupExpiredSuggestions).toHaveBeenCalled();
      expect(result.actions_taken).toContainEqual({
        action: 'suggestion_cleanup',
        cleanup_count: 3
      });
    });

    test('does not execute cleanup when interval not elapsed', async () => {
      // Mock cleanup interval not elapsed
      const mockDate = new Date();
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(mockDate.getTime() - 1000) // _lastCleanupTime (1 second ago)
        .mockReturnValueOnce(mockDate.getTime()); // current time

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
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
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
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock cleanup interval elapsed
      const mockDate = new Date();
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(mockDate.getTime() - (60 * 60 * 1000 + 1))
        .mockReturnValueOnce(mockDate.getTime());

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
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

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
      const { evaluateAlertness } = await import('../alertness/index.js');

      executeTriage.mockResolvedValue([{ id: '1' }]);

      const result = await executeTick();

      expect(evaluateAlertness).toHaveBeenCalled();
      expect(executeTriage).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});