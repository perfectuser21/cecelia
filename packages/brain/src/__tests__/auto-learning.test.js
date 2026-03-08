/**
 * Tests for auto-learning module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock crypto module
vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn(() => ({
        digest: vi.fn(() => ({
          slice: vi.fn(() => 'mock-hash-1234')
        }))
      }))
    }))
  }
}));

describe('Auto Learning Module', () => {
  let mockPool;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database pool
    mockPool = {
      query: vi.fn()
    };

    // Mock db.js module
    vi.doMock('../db.js', () => ({
      default: mockPool
    }));

    vi.resetModules();
  });

  describe('processExecutionAutoLearning', () => {
    it('should create learning for completed dev task', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      // Mock database responses
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Fix bug' }]
        }) // Task query
        .mockResolvedValueOnce({
          rows: []
        }) // Duplicate check - not found
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-123', title: '任务完成：test-task' }]
        }); // Insert learning

      const result = await processExecutionAutoLearning(
        'test-task',
        'completed',
        'Task completed successfully'
      );

      expect(result).toEqual({
        id: 'learning-123',
        title: '任务完成：test-task'
      });

      // Verify database calls
      expect(mockPool.query).toHaveBeenCalledTimes(3);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        'SELECT task_type, title, payload FROM tasks WHERE id = $1',
        ['test-task']
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
        ['mock-hash-1234']
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO learnings'),
        expect.arrayContaining([
          '任务完成：test-task',
          'execution_result',
          'task_completed_auto'
        ])
      );
    });

    it('should create learning for failed feature task', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'feature', title: 'New feature' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-failed', title: '任务失败：failed-task' }]
        });

      const result = await processExecutionAutoLearning(
        'failed-task',
        'failed',
        { error: 'Network timeout' },
        { retry_count: 2 }
      );

      expect(result).toEqual({
        id: 'learning-failed',
        title: '任务失败：failed-task'
      });

      expect(mockPool.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO learnings'),
        expect.arrayContaining([
          '任务失败：failed-task',
          'failure_pattern',
          'task_failed_auto'
        ])
      );
    });

    it('should skip learning for non-valuable task types', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query.mockResolvedValueOnce({
        rows: [{ task_type: 'code_review', title: 'Review PR' }]
      });

      const result = await processExecutionAutoLearning(
        'review-task',
        'completed',
        'Review completed'
      );

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledTimes(1); // Only task query
    });

    it('should skip duplicate content', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Test task' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'existing-learning' }] // Duplicate found
        });

      const result = await processExecutionAutoLearning(
        'dup-task',
        'completed',
        'Duplicate content'
      );

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledTimes(2); // Task query + duplicate check only
    });

    it('should handle missing task gracefully', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query.mockResolvedValueOnce({
        rows: [] // Task not found
      });

      const result = await processExecutionAutoLearning(
        'missing-task',
        'completed',
        'result'
      );

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should handle database errors gracefully', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await processExecutionAutoLearning(
        'error-task',
        'completed',
        'result'
      );

      expect(result).toBeNull();
    });
  });

  describe('Daily budget management', () => {
    it('should return correct stats', async () => {
      const { getAutoLearningStats, DAILY_AUTO_LEARNING_BUDGET, VALUABLE_TASK_TYPES } = await import('../auto-learning.js');

      const stats = getAutoLearningStats();

      expect(stats).toMatchObject({
        dailyCount: expect.any(Number),
        dailyBudget: DAILY_AUTO_LEARNING_BUDGET,
        budgetRemaining: expect.any(Number),
        lastResetDate: expect.any(String),
        valuableTaskTypes: VALUABLE_TASK_TYPES
      });
      expect(stats.dailyBudget).toBe(50);
      expect(stats.valuableTaskTypes).toEqual(['dev', 'feature', 'research']);
    });

    it('should reset state correctly', async () => {
      const { _resetAutoLearningState, getAutoLearningStats } = await import('../auto-learning.js');

      _resetAutoLearningState();

      const stats = getAutoLearningStats();
      expect(stats.dailyCount).toBe(0);
      expect(stats.budgetRemaining).toBe(50);
    });
  });

  describe('Content handling', () => {
    it('should handle string results', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'research', title: 'Research task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-string', title: '任务完成：string-task' }]
        });

      await processExecutionAutoLearning(
        'string-task',
        'completed',
        'Simple string result'
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('任务成功完成。类型：research');
      expect(content).toContain('摘要：Simple string result');
    });

    it('should handle object results', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Dev task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-obj', title: '任务完成：obj-task' }]
        });

      await processExecutionAutoLearning(
        'obj-task',
        'completed',
        {
          result: 'Feature implemented',
          findings: 'All tests pass'
        }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('任务成功完成。类型：dev');
      expect(content).toContain('摘要：Feature implemented');
    });

    it('should truncate long content', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      const longResult = 'A'.repeat(600);

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Long task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-long', title: '任务完成：long-task' }]
        });

      await processExecutionAutoLearning(
        'long-task',
        'completed',
        longResult
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content.length).toBeLessThan(600);
      expect(content).toContain('任务成功完成。类型：dev');
    });

    it('should extract error_details from failed task result', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Failed task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-err', title: '任務失敗：err-task' }]
        });

      await processExecutionAutoLearning(
        'err-task',
        'failed',
        { error_details: 'Connection refused to localhost:5432' }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('Connection refused to localhost:5432');
    });

    it('should extract error field when error_details is absent', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Error task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-e2', title: '任務失敗：e2-task' }]
        });

      await processExecutionAutoLearning(
        'e2-task',
        'failed',
        { error: 'Network timeout after 30s' }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('Network timeout after 30s');
    });

    it('should extract message field as fallback', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Msg task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-msg', title: '任務失敗：msg-task' }]
        });

      await processExecutionAutoLearning(
        'msg-task',
        'failed',
        { message: 'Disk full on /dev/sda1' }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('Disk full on /dev/sda1');
    });

    it('should handle object error_details by stringifying', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Obj err task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-oe', title: '任務失敗：oe-task' }]
        });

      await processExecutionAutoLearning(
        'oe-task',
        'failed',
        { error_details: { code: 'ECONNREFUSED', host: 'localhost', port: 5432 } }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('ECONNREFUSED');
      expect(content).toContain('localhost');
    });
  });

  describe('Metadata and structure', () => {
    it('should include correct metadata for completed task', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'dev', title: 'Test task' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-meta', title: '任务完成：meta-task' }]
        });

      await processExecutionAutoLearning(
        'meta-task',
        'completed',
        'success',
        {
          trigger_source: 'execution_callback',
          metadata: { run_id: 'run-456' }
        }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const metadataJson = insertCall[1][4];
      const metadata = JSON.parse(metadataJson);

      expect(metadata).toMatchObject({
        task_id: 'meta-task',
        task_type: 'dev',
        trigger_source: 'execution_callback',
        auto_generated: true,
        created_at: expect.any(String)
      });
    });

    it('should include retry count for failed task', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ task_type: 'feature', title: 'Failed feature' }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-retry', title: '任务失败：retry-task' }]
        });

      await processExecutionAutoLearning(
        'retry-task',
        'failed',
        'error occurred',
        { retry_count: 3 }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const metadataJson = insertCall[1][4];
      const metadata = JSON.parse(metadataJson);

      expect(metadata).toMatchObject({
        task_id: 'retry-task',
        task_type: 'feature',
        retry_count: 3,
        auto_generated: true
      });
    });
  });

  describe('enrichResultWithPayload', () => {
    it('should inject error_excerpt when result is null', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const payload = {
        failure_class: 'network',
        failure_detail: { error_excerpt: 'Connection refused to localhost:5432' }
      };

      const enriched = enrichResultWithPayload(null, payload);

      expect(enriched).toEqual({
        original_result: null,
        error_details: 'Connection refused to localhost:5432',
        failure_class: 'network',
      });
    });

    it('should inject error_excerpt when result is empty string', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const payload = {
        failure_class: 'billing_cap',
        failure_detail: { error_excerpt: 'Spending cap reached' }
      };

      const enriched = enrichResultWithPayload('', payload);

      expect(enriched).toEqual({
        original_result: '',
        error_details: 'Spending cap reached',
        failure_class: 'billing_cap',
      });
    });

    it('should not overwrite existing error field in result', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const result = { error: 'Original error from agent' };
      const payload = {
        failure_class: 'network',
        failure_detail: { error_excerpt: 'Different error from payload' }
      };

      const enriched = enrichResultWithPayload(result, payload);

      expect(enriched).toEqual({ error: 'Original error from agent' });
    });

    it('should not overwrite existing error_details in result', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const result = { error_details: 'Existing details' };
      const payload = {
        failure_class: 'transient',
        failure_detail: { error_excerpt: 'Payload details' }
      };

      const enriched = enrichResultWithPayload(result, payload);

      expect(enriched).toEqual({ error_details: 'Existing details' });
    });

    it('should inject into object result lacking error fields', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const result = { result: 'some output', code: 1 };
      const payload = {
        failure_class: 'code_error',
        failure_detail: { error_excerpt: 'Exit code 1: test failed' }
      };

      const enriched = enrichResultWithPayload(result, payload);

      expect(enriched).toEqual({
        result: 'some output',
        code: 1,
        error_details: 'Exit code 1: test failed',
        failure_class: 'code_error',
      });
    });

    it('should return original result when payload has no error info', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const result = { result: 'output' };
      const payload = { dispatched_account: 'acc1' };

      const enriched = enrichResultWithPayload(result, payload);

      expect(enriched).toEqual({ result: 'output' });
    });

    it('should return original result when payload is null', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const result = { error: 'some error' };
      const enriched = enrichResultWithPayload(result, null);

      expect(enriched).toEqual({ error: 'some error' });
    });

    it('should prefer error_details from payload over error_excerpt', async () => {
      const { enrichResultWithPayload } = await import('../auto-learning.js');

      const payload = {
        error_details: 'Detailed error from error-report API',
        failure_class: 'permanent',
        failure_detail: { error_excerpt: 'Short excerpt' }
      };

      const enriched = enrichResultWithPayload(null, payload);

      expect(enriched.error_details).toBe('Detailed error from error-report API');
    });
  });

  describe('payload enrichment integration', () => {
    it('should use payload error_excerpt in learning content when result is empty', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            task_type: 'dev',
            title: 'Fix auth',
            payload: {
              failure_class: 'network',
              failure_detail: { error_excerpt: 'ECONNREFUSED 127.0.0.1:5432' }
            }
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-payload', title: '任务失败：payload-task' }]
        });

      await processExecutionAutoLearning('payload-task', 'failed', null, { retry_count: 1 });

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('ECONNREFUSED 127.0.0.1:5432');
    });

    it('should not enrich result for completed tasks', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            task_type: 'dev',
            title: 'Complete task',
            payload: {
              failure_class: 'stale',
              failure_detail: { error_excerpt: 'Old error from previous run' }
            }
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-ok', title: '任务完成：ok-task' }]
        });

      await processExecutionAutoLearning('ok-task', 'completed', 'Success!');

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('Success!');
      expect(content).not.toContain('Old error');
    });
  });
});