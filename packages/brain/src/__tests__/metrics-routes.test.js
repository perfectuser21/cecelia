/**
 * Metrics Routes Unit Tests (mock pool — no real DB needed)
 *
 * 测试覆盖：
 * - GET /success-rate：空库返回 0，有数据时正确计算，DB 错误 500
 * - POST /tasks/:id/execution-attempt：正常递增，404 处理
 * - PATCH /tasks/:id/pr-merged：正常更新，400 缺少 pr_url，404 处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js before importing routes
vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
  };
  return { default: mockPool };
});

import pool from '../db.js';
import metricsRoutes from '../routes/metrics.js';

// Helper: 从 router stack 获取 handler
function getHandler(method, path) {
  const layers = metricsRoutes.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

// Helper: 创建 mock req/res（支持状态码）
function mockReqRes(params = {}, body = {}, query = {}) {
  let statusCode = 200;
  const res = {
    _data: null,
    _status: 200,
    status(code) {
      statusCode = code;
      this._status = code;
      return this;
    },
    json(data) {
      this._data = data;
      this._status = statusCode;
      return this;
    },
  };
  const req = { params, body, query };
  return { req, res };
}

describe('metrics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /success-rate ────────────────────────────────────────────
  describe('GET /success-rate', () => {
    const handler = getHandler('get', '/success-rate');

    it('空数据库时返回 success_rate: 0', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '0', completed_tasks: '0', pr_merged_tasks: '0', avg_attempts: null }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '0', pr_merged_tasks: '0', recent_3days_merged: '0', older_merged: '0' }],
        });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.overall.success_rate).toBe(0);
      expect(res._data.overall.total_tasks).toBe(0);
      expect(res._data.overall.pr_merged_tasks).toBe(0);
      expect(res._data.recent_7days.success_rate).toBe(0);
      expect(res._data.recent_7days.trend).toBe('stable');
    });

    it('有 pr_merged_at 数据时正确计算成功率', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '100', completed_tasks: '65', pr_merged_tasks: '45', avg_attempts: '1.80' }],
        })
        .mockResolvedValueOnce({
          rows: [
            { task_type: 'dev', total: '80', pr_merged: '40' },
            { task_type: 'review', total: '20', pr_merged: '5' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '40', pr_merged_tasks: '22', recent_3days_merged: '15', older_merged: '7' }],
        });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.overall.total_tasks).toBe(100);
      expect(res._data.overall.pr_merged_tasks).toBe(45);
      expect(res._data.overall.success_rate).toBe(0.45);
      expect(res._data.overall.avg_attempts).toBe(1.8);
      expect(res._data.by_task_type.dev.total).toBe(80);
      expect(res._data.by_task_type.dev.success_rate).toBe(0.5);
      expect(res._data.by_task_type.review.success_rate).toBe(0.25);
    });

    it('recent_7days 趋势：improving（最近 3 天 > 早期 4 天）', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '10', completed_tasks: '5', pr_merged_tasks: '5', avg_attempts: '1.00' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '20', pr_merged_tasks: '10', recent_3days_merged: '8', older_merged: '2' }],
        });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.recent_7days.trend).toBe('improving');
    });

    it('recent_7days 趋势：declining（最近 3 天 < 早期 4 天）', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '10', completed_tasks: '5', pr_merged_tasks: '5', avg_attempts: '1.00' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '20', pr_merged_tasks: '10', recent_3days_merged: '2', older_merged: '8' }],
        });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.recent_7days.trend).toBe('declining');
    });

    it('DB 查询失败时返回 500', async () => {
      pool.query.mockRejectedValue(new Error('connection refused'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toBe('Failed to calculate success rate');
    });

    it('成功率计算公式正确：pr_merged_tasks / total_tasks', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '200', completed_tasks: '100', pr_merged_tasks: '70', avg_attempts: '2.00' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ total_tasks: '50', pr_merged_tasks: '25', recent_3days_merged: '12', older_merged: '13' }],
        });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.overall.success_rate).toBe(0.35); // 70/200
      expect(res._data.recent_7days.success_rate).toBe(0.5); // 25/50
    });
  });

  // ─── POST /tasks/:id/execution-attempt ───────────────────────────
  describe('POST /tasks/:id/execution-attempt', () => {
    const handler = getHandler('post', '/tasks/:id/execution-attempt');

    it('正常调用后 execution_attempts 递增', async () => {
      pool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'task-1', title: 'Test Task', execution_attempts: 1, last_attempt_at: new Date().toISOString() }],
      });

      const { req, res } = mockReqRes({ id: 'task-1' }, {});
      await handler(req, res);

      expect(res._data.execution_attempts).toBe(1);
      expect(res._data.task_id).toBe('task-1');
      expect(pool.query).toHaveBeenCalledTimes(1);

      // 验证 SQL 包含 execution_attempts 递增
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('execution_attempts');
      expect(sql).toContain('COALESCE(execution_attempts, 0) + 1');
    });

    it('task 不存在时返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const { req, res } = mockReqRes({ id: 'non-existent-id' }, {});
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.error).toBe('Task not found');
    });

    it('带 started_at 参数时正确传入', async () => {
      const startedAt = '2026-03-06T10:00:00Z';
      pool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'task-1', title: 'Test', execution_attempts: 2, last_attempt_at: startedAt }],
      });

      const { req, res } = mockReqRes({ id: 'task-1' }, { attempt_number: 2, started_at: startedAt });
      await handler(req, res);

      // 第一个 query 的第二个参数应为 startedAt
      expect(pool.query.mock.calls[0][1][1]).toBe(startedAt);
    });

    it('DB 失败时返回 500', async () => {
      pool.query.mockRejectedValue(new Error('db error'));

      const { req, res } = mockReqRes({ id: 'task-1' }, {});
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toBe('Failed to record execution attempt');
    });
  });

  // ─── PATCH /tasks/:id/pr-merged ──────────────────────────────────
  describe('PATCH /tasks/:id/pr-merged', () => {
    const handler = getHandler('patch', '/tasks/:id/pr-merged');

    it('正常调用后返回更新后的 task', async () => {
      const prUrl = 'https://github.com/perfectuser21/cecelia/pull/123';
      pool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          title: 'Test Task',
          status: 'completed',
          pr_url: prUrl,
          pr_merged_at: new Date().toISOString(),
          success_metrics: { total_duration_minutes: 120 },
          execution_attempts: 2,
        }],
      });

      const { req, res } = mockReqRes(
        { id: 'task-1' },
        { pr_url: prUrl, merged_at: '2026-03-06T12:00:00Z', metrics: { total_duration_minutes: 120 } }
      );
      await handler(req, res);

      expect(res._data.pr_url).toBe(prUrl);
      expect(res._data.status).toBe('completed');
      expect(res._data.execution_attempts).toBe(2);
    });

    it('缺少 pr_url 时返回 400', async () => {
      const { req, res } = mockReqRes({ id: 'task-1' }, {});
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.error).toBe('pr_url is required');
      // 不应该调用 DB
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('task 不存在时返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const { req, res } = mockReqRes(
        { id: 'non-existent' },
        { pr_url: 'https://github.com/test/pull/1' }
      );
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.error).toBe('Task not found');
    });

    it('DB 失败时返回 500', async () => {
      pool.query.mockRejectedValue(new Error('db error'));

      const { req, res } = mockReqRes(
        { id: 'task-1' },
        { pr_url: 'https://github.com/test/pull/1' }
      );
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toBe('Failed to mark PR as merged');
    });

    it('success_metrics 为 null 时正常处理', async () => {
      pool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'task-1',
          title: 'Test',
          status: 'completed',
          pr_url: 'https://github.com/test/pull/1',
          pr_merged_at: new Date().toISOString(),
          success_metrics: null,
          execution_attempts: 1,
        }],
      });

      const { req, res } = mockReqRes(
        { id: 'task-1' },
        { pr_url: 'https://github.com/test/pull/1' }
      );
      await handler(req, res);

      expect(res._data.success_metrics).toBeNull();
      expect(res._status).toBe(200);
    });
  });
});
