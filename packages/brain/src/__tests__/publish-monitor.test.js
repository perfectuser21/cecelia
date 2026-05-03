import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
const pool = { query: mockQuery };

vi.mock('../publish-monitor.js', async (importOriginal) => {
  const mod = await importOriginal();
  return mod;
});

describe('publish-monitor', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('retryTask', () => {
    it('重排 queued 时 SQL 包含 claimed_by = NULL 和 claimed_at = NULL', async () => {
      // retryTask is internal, test via monitorPublishQueue with mocked pool
      // Verify the retryTask SQL contains claimed_by = NULL
      const { monitorPublishQueue } = await import('../publish-monitor.js');

      // fetchRetryableTasks returns 1 failed task
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'pub-task-1', title: 'test', retry_count: 0, payload: { platform: 'instagram', pipeline_id: 'p-1' } }] }) // fetchRetryableTasks
        .mockResolvedValueOnce({ rows: [] }) // isAlreadyPublished (no completed)
        .mockResolvedValueOnce({ rows: [] }) // retryTask UPDATE
        .mockResolvedValueOnce({ rows: [] }) // fetchTodayStats
        .mockResolvedValueOnce({ rows: [] }); // writeStats

      await monitorPublishQueue(pool);

      // retryTask call is the 3rd query (index 2)
      const retrySql = mockQuery.mock.calls[2][0];
      expect(retrySql).toContain('claimed_by = NULL');
      expect(retrySql).toContain('claimed_at = NULL');
      expect(retrySql).toContain("status = 'queued'");
    });

    it('monitorPublishQueue 返回 retried 计数', async () => {
      const { monitorPublishQueue } = await import('../publish-monitor.js');

      // no retryable tasks
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // fetchRetryableTasks
        .mockResolvedValueOnce({ rows: [] }) // fetchTodayStats
        .mockResolvedValueOnce({ rows: [] }); // writeStats

      const result = await monitorPublishQueue(pool);
      expect(result).toHaveProperty('retried');
      expect(result.retried).toBe(0);
    });
  });
});
