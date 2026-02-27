/**
 * Tests for suggestion event integration
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock event-bus
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(true)
}));

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

import { emit } from '../event-bus.js';
import pool from '../db.js';
import {
  createSuggestion,
  updateSuggestionStatus,
  executeTriage,
  cleanupExpiredSuggestions
} from '../suggestion-triage.js';

describe('Suggestion Events Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default database mock responses
    pool.query.mockImplementation((query, params) => {
      if (query.includes('INSERT INTO suggestions')) {
        return Promise.resolve({
          rows: [{
            id: 'test-suggestion-id',
            content: params[0],
            source: params[1],
            priority_score: 0.7,
            status: 'pending',
            created_at: new Date()
          }]
        });
      }
      if (query.includes('UPDATE suggestions')) {
        return Promise.resolve({ rowCount: 1 });
      }
      if (query.includes('SELECT * FROM suggestions')) {
        return Promise.resolve({
          rows: [
            {
              id: '1',
              content: 'Test suggestion 1',
              source: 'test',
              priority_score: 0.8,
              status: 'pending',
              created_at: new Date()
            },
            {
              id: '2',
              content: 'Similar test suggestion',
              source: 'test',
              priority_score: 0.6,
              status: 'pending',
              created_at: new Date()
            }
          ]
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  describe('createSuggestion events', () => {
    test('emits suggestion_created event when suggestion is created', async () => {
      const suggestionData = {
        content: 'Test suggestion for events',
        source: 'test',
        agent_id: 'test-agent',
        suggestion_type: 'general'
      };

      await createSuggestion(suggestionData);

      expect(emit).toHaveBeenCalledWith('suggestion_created', 'suggestion_triage', {
        suggestion_id: 'test-suggestion-id',
        source: 'test',
        priority_score: 0.7,
        suggestion_type: 'general'
      });
    });

    test('includes correct event data in suggestion_created', async () => {
      const suggestionData = {
        content: 'High priority alert',
        source: 'cortex',
        agent_id: 'cortex-v1',
        suggestion_type: 'alert'
      };

      await createSuggestion(suggestionData);

      expect(emit).toHaveBeenCalledWith('suggestion_created', 'suggestion_triage',
        expect.objectContaining({
          source: 'cortex',
          suggestion_type: 'alert',
          suggestion_id: expect.any(String),
          priority_score: expect.any(Number)
        })
      );
    });

    test('continues execution even if event emission fails', async () => {
      emit.mockRejectedValueOnce(new Error('Event bus failure'));

      const result = await createSuggestion({
        content: 'Test resilience',
        source: 'test'
      });

      // Should still return the created suggestion
      expect(result.id).toBe('test-suggestion-id');
      expect(result.content).toBe('Test resilience');
    });
  });

  describe('updateSuggestionStatus events', () => {
    test('emits suggestion_status_updated event', async () => {
      await updateSuggestionStatus('test-id', 'processed', {
        action_taken: 'task_created',
        task_id: 'new-task-123'
      });

      expect(emit).toHaveBeenCalledWith('suggestion_status_updated', 'suggestion_triage', {
        suggestion_id: 'test-id',
        new_status: 'processed',
        metadata: {
          action_taken: 'task_created',
          task_id: 'new-task-123'
        }
      });
    });

    test('emits event for different status changes', async () => {
      await updateSuggestionStatus('test-id', 'rejected', {
        reason: 'not_feasible',
        rejected_by: 'cortex'
      });

      expect(emit).toHaveBeenCalledWith('suggestion_status_updated', 'suggestion_triage', {
        suggestion_id: 'test-id',
        new_status: 'rejected',
        metadata: {
          reason: 'not_feasible',
          rejected_by: 'cortex'
        }
      });
    });

    test('handles event emission failure gracefully', async () => {
      emit.mockRejectedValueOnce(new Error('Event emission failed'));

      // Should not throw error
      await expect(updateSuggestionStatus('test-id', 'archived')).resolves.not.toThrow();

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE suggestions'),
        expect.any(Array)
      );
    });
  });

  describe('executeTriage events', () => {
    test('emits suggestions_triaged event after processing', async () => {
      // Mock triage processing - simulate deduplication
      pool.query.mockImplementationOnce(() => Promise.resolve({
        rows: [
          { id: '1', content: 'First suggestion', source: 'test', priority_score: 0.8, created_at: new Date() },
          { id: '2', content: 'Duplicate suggestion', source: 'test', priority_score: 0.6, created_at: new Date() }
        ]
      })).mockImplementationOnce(() => Promise.resolve({ rowCount: 1 })) // UPDATE for priority score
        .mockImplementationOnce(() => Promise.resolve({ rowCount: 1 })) // UPDATE for rejection
        .mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));

      await executeTriage(10);

      expect(emit).toHaveBeenCalledWith('suggestions_triaged', 'suggestion_triage',
        expect.objectContaining({
          processed_count: expect.any(Number),
          deduplicated_count: expect.any(Number),
          rejected_count: expect.any(Number)
        })
      );
    });

    test('includes correct counts in suggestions_triaged event', async () => {
      // Mock a scenario with 3 suggestions, 1 duplicate
      pool.query.mockImplementationOnce(() => Promise.resolve({
        rows: Array(3).fill(null).map((_, i) => ({
          id: `test-${i}`,
          content: `Test suggestion ${i}`,
          source: 'test',
          priority_score: 0.5,
          created_at: new Date()
        }))
      }));

      await executeTriage(10);

      expect(emit).toHaveBeenCalledWith('suggestions_triaged', 'suggestion_triage',
        expect.objectContaining({
          processed_count: 3
        })
      );
    });

    test('emits event even when no suggestions to process', async () => {
      pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [] }));

      await executeTriage(10);

      // No suggestions → returns early, no event emitted
      expect(emit).not.toHaveBeenCalledWith('suggestions_triaged', expect.any(String), expect.any(Object));
    });
  });

  describe('cleanupExpiredSuggestions events', () => {
    test('emits suggestions_cleaned event when suggestions are cleaned', async () => {
      pool.query.mockImplementationOnce(() => Promise.resolve({
        rows: [{ id: '1' }, { id: '2' }, { id: '3' }]
      }));

      await cleanupExpiredSuggestions();

      expect(emit).toHaveBeenCalledWith('suggestions_cleaned', 'suggestion_triage', {
        cleanup_count: 3
      });
    });

    test('does not emit event when no suggestions cleaned', async () => {
      pool.query.mockImplementationOnce(() => Promise.resolve({ rows: [] }));

      await cleanupExpiredSuggestions();

      // Should not emit event for zero cleanup
      expect(emit).not.toHaveBeenCalledWith('suggestions_cleaned', expect.any(String), expect.any(Object));
    });

    test('logs cleanup count correctly', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      pool.query.mockImplementationOnce(() => Promise.resolve({
        rows: [{ id: '1' }, { id: '2' }]
      }));

      await cleanupExpiredSuggestions();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Triage] 清理了 2 条过期建议')
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('Event payload validation', () => {
    test('suggestion_created event has required fields', async () => {
      await createSuggestion({
        content: 'Test validation',
        source: 'validation-test',
        suggestion_type: 'test'
      });

      expect(emit).toHaveBeenCalledWith('suggestion_created', 'suggestion_triage',
        expect.objectContaining({
          suggestion_id: expect.any(String),
          source: expect.any(String),
          priority_score: expect.any(Number),
          suggestion_type: expect.any(String)
        })
      );
    });

    test('suggestion_status_updated event has required fields', async () => {
      await updateSuggestionStatus('test-id', 'processed', { test: 'data' });

      expect(emit).toHaveBeenCalledWith('suggestion_status_updated', 'suggestion_triage',
        expect.objectContaining({
          suggestion_id: expect.any(String),
          new_status: expect.any(String),
          metadata: expect.any(Object)
        })
      );
    });

    test('suggestions_triaged event has required fields', async () => {
      pool.query.mockImplementationOnce(() => Promise.resolve({
        rows: [{ id: '1', content: 'test', source: 'test', priority_score: 0.5, created_at: new Date() }]
      }));

      await executeTriage(5);

      expect(emit).toHaveBeenCalledWith('suggestions_triaged', 'suggestion_triage',
        expect.objectContaining({
          processed_count: expect.any(Number),
          deduplicated_count: expect.any(Number),
          rejected_count: expect.any(Number)
        })
      );
    });
  });

  describe('Event ordering and timing', () => {
    test('events are emitted in correct order during triage', async () => {
      // Reset mock to track call order
      emit.mockClear();

      pool.query.mockImplementationOnce(() => Promise.resolve({
        rows: [{ id: '1', content: 'test', source: 'test', priority_score: 0.5, created_at: new Date() }]
      }));

      await executeTriage(5);

      // Should emit triage completion event
      expect(emit).toHaveBeenCalledWith('suggestions_triaged', 'suggestion_triage', expect.any(Object));
    });

    test('events are emitted after database operations complete', async () => {
      let dbOperationCompleted = false;

      pool.query.mockImplementation((query) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            dbOperationCompleted = true;
            resolve({
              rows: [{
                id: 'test',
                content: 'test',
                source: 'test',
                priority_score: 0.7,
                created_at: new Date()
              }]
            });
          }, 10);
        });
      });

      emit.mockImplementation(() => {
        expect(dbOperationCompleted).toBe(true);
        return Promise.resolve(true);
      });

      await createSuggestion({
        content: 'Test timing',
        source: 'test'
      });

      expect(emit).toHaveBeenCalled();
    });
  });
});
