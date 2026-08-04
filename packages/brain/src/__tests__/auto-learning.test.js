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

describe('extractTaskSummary', () => {
  it('should return default message for null/undefined result', async () => {
    const { extractTaskSummary } = await import('../auto-learning.js');
    expect(extractTaskSummary(null)).toBe('No details available');
    expect(extractTaskSummary(undefined)).toBe('No details available');
  });

  it('should return truncated string for string result', async () => {
    const { extractTaskSummary } = await import('../auto-learning.js');
    expect(extractTaskSummary('hello world')).toBe('hello world');
    expect(extractTaskSummary('A'.repeat(600), 500)).toHaveLength(500);
  });

  it('should return unknown format message for non-object primitives', async () => {
    const { extractTaskSummary } = await import('../auto-learning.js');
    expect(extractTaskSummary(42)).toBe('Unknown result format');
    expect(extractTaskSummary(true)).toBe('Unknown result format');
  });

  it('should extract run result fields when exit_code/stderr_tail/failure_class present', async () => {
    const { extractTaskSummary } = await import('../auto-learning.js');
    const result = extractTaskSummary({ exit_code: 1, failure_class: 'code_error', error: 'Test failed' });
    expect(result).toContain('exit_code=1');
    expect(result).toContain('failure_class=code_error');
  });

  it('should extract object summary fields for plain objects', async () => {
    const { extractTaskSummary } = await import('../auto-learning.js');
    const result = extractTaskSummary({ error_details: 'Connection refused' });
    expect(result).toContain('Connection refused');
  });
});

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
    it('should NOT create learning for completed task (T9: event-layer noise)', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query.mockResolvedValueOnce({
        rows: [{ task_type: 'dev', title: 'Fix bug' }]
      }); // Task query

      const result = await processExecutionAutoLearning(
        'test-task',
        'completed',
        'Task completed successfully'
      );

      expect(result).toBeNull();
      // 只查了 task 信息，没有 dedup 查询、没有 INSERT
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should write non-empty summary column for failed task learning', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'dev', title: 'Broken task', error_message: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'learning-fail-1', title: '任务失败：fail-task' }] });

      await processExecutionAutoLearning('fail-task', 'failed', { error: 'boom' });

      const insertCall = mockPool.query.mock.calls[2];
      expect(insertCall[0]).toContain('summary');
      const params = insertCall[1];
      const summaryParam = params[params.length - 1]; // summary 是最后一个参数
      expect(typeof summaryParam).toBe('string');
      expect(summaryParam.length).toBeGreaterThan(0);
      expect(summaryParam.length).toBeLessThanOrEqual(100);
    });

    it('should reject noise categories in createAutoLearning', async () => {
      const { createAutoLearning } = await import('../auto-learning.js');
      const result = await createAutoLearning({
        title: 'noise',
        category: 'task_completion',
        content: 'x',
        triggerEvent: 'task_completed',
        metadata: {},
      });
      expect(result).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
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

      // T9 后 completed 路径已停写，去重逻辑用 failed 路径覆盖
      const result = await processExecutionAutoLearning(
        'dup-task',
        'failed',
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
      expect(stats.valuableTaskTypes).toEqual(['dev', 'feature', 'research', 'harness_initiative']);
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
          rows: [{ id: 'learning-string', title: '任务失败：string-task' }]
        });

      // T9 后 completed 路径已停写，内容组装用 failed 路径覆盖
      await processExecutionAutoLearning(
        'string-task',
        'failed',
        'Simple string result'
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('任务执行失败');
      expect(content).toContain('错误摘要：Simple string result');
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
          rows: [{ id: 'learning-obj', title: '任务失败：obj-task' }]
        });

      // T9 后 completed 路径已停写，内容组装用 failed 路径覆盖
      await processExecutionAutoLearning(
        'obj-task',
        'failed',
        {
          result: 'Feature implemented',
          findings: 'All tests pass'
        }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content).toContain('任务执行失败');
      expect(content).toContain('错误摘要：Feature implemented');
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
          rows: [{ id: 'learning-long', title: '任务失败：long-task' }]
        });

      // T9 后 completed 路径已停写，截断逻辑用 failed 路径覆盖
      await processExecutionAutoLearning(
        'long-task',
        'failed',
        longResult
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      expect(content.length).toBeLessThan(600);
      expect(content).toContain('任务执行失败');
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

    it('should use DB error_message as fallback when result is null (dbErrorMessage fallback)', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            task_type: 'dev',
            title: 'Null result task',
            error_message: '[callback: result=null] task=null-task exit_code=N/A | callback received but result was null'
          }]
        })
        .mockResolvedValueOnce({
          rows: []
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'learning-fallback', title: '任务失败：null-task' }]
        });

      await processExecutionAutoLearning(
        'null-task',
        'failed',
        null, // effectiveResult=null, 全空 callback 场景
        { retry_count: 0 }
      );

      const insertCall = mockPool.query.mock.calls[2];
      const content = insertCall[1][3];

      // DB error_message 应作为 fallback，不再出现 "No details available"
      expect(content).not.toContain('No details available');
      expect(content).toContain('[callback: result=null]');
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
});