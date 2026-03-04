/**
 * Stats Routes Unit Tests — dev 任务执行成功率统计 API
 * 使用 Vitest + mock db.js（无需真实数据库）
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
import statsRoutes from '../routes/stats.js';

// ===== 辅助函数 =====

/**
 * 从 Express Router 中提取 GET 路由处理器
 */
function getHandler(path) {
  const layers = statsRoutes.stack.filter(
    l => l.route && l.route.methods['get'] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No GET handler for ${path}`);
  return layers[0].route.stack[0].handle;
}

/**
 * 创建 mock req/res 对象
 */
function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    _status: 200,
    _data: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._data = data;
      return this;
    },
  };
  return { req, res };
}

// ===== 测试套件 =====

describe('GET /dev-success-rate', () => {
  const handler = getHandler('/dev-success-rate');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- 参数验证 ---

  describe('参数验证', () => {
    it('非数字 days 返回 400', async () => {
      const { req, res } = mockReqRes({ days: 'abc' });
      await handler(req, res);
      expect(res._status).toBe(400);
      expect(res._data.error).toMatch(/Invalid days/);
    });

    it('days <= 0 返回 400', async () => {
      const { req, res } = mockReqRes({ days: '0' });
      await handler(req, res);
      expect(res._status).toBe(400);
      expect(res._data.error).toMatch(/must be > 0/);
    });

    it('days 为负数返回 400', async () => {
      const { req, res } = mockReqRes({ days: '-5' });
      await handler(req, res);
      expect(res._status).toBe(400);
    });

    it('days > 90 返回 400', async () => {
      const { req, res } = mockReqRes({ days: '91' });
      await handler(req, res);
      expect(res._status).toBe(400);
      expect(res._data.error).toMatch(/must be <= 90/);
    });
  });

  // --- 正常数据 ---

  describe('正常统计数据', () => {
    it('返回 7 天默认统计数据（含每日趋势）', async () => {
      // Mock 整体统计查询
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'completed', failure_reason: null, cnt: '70' },
            { status: 'failed', failure_reason: 'CI workflow failed', cnt: '15' },
            { status: 'failed', failure_reason: 'branch protection prevented push', cnt: '5' },
            { status: 'cancelled', failure_reason: null, cnt: '10' },
          ],
        })
        // Mock 每日趋势查询
        .mockResolvedValueOnce({
          rows: [
            { date: '2026-02-26', success: '10', failed: '3', cancelled: '1', total: '14' },
            { date: '2026-02-27', success: '12', failed: '2', cancelled: '0', total: '14' },
          ],
        });

      const { req, res } = mockReqRes(); // 默认 7 天
      await handler(req, res);

      expect(res._status).toBe(200);
      const data = res._data;

      // 整体统计
      expect(data.period_days).toBe(7);
      expect(data.total).toBe(100);
      expect(data.success).toBe(70);
      expect(data.failed).toBe(20);
      expect(data.cancelled).toBe(10);
      // success_rate = 70 / (100 - 10) * 100 = 77.8%
      expect(data.success_rate).toBe(77.8);

      // 每日趋势
      expect(data.daily_trend).toHaveLength(2);
      expect(data.daily_trend[0].date).toBe('2026-02-26');
      expect(data.daily_trend[0].success).toBe(10);
      expect(data.daily_trend[0].success_rate).toBe(76.9); // 10 / 13 ≈ 76.9

      // 失败原因分类
      expect(data.failure_reasons.ci_failure).toBe(15);
      expect(data.failure_reasons.branch_protection).toBe(5);
      expect(data.failure_reasons.dev_skill_error).toBe(0);
      expect(data.failure_reasons.other).toBe(0);
    });

    it('支持自定义 days=30 参数', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ status: 'completed', failure_reason: null, cnt: '50' }] })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes({ days: '30' });
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.period_days).toBe(30);
    });

    it('pool.query 被调用了两次（整体 + 每日）', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });

  // --- 空数据 ---

  describe('空数据处理', () => {
    it('无数据时 success_rate 为 0，不报错', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.total).toBe(0);
      expect(res._data.success).toBe(0);
      expect(res._data.success_rate).toBe(0);
      expect(res._data.daily_trend).toHaveLength(0);
    });

    it('全部取消时 success_rate 为 0（分母为 0）', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ status: 'cancelled', failure_reason: null, cnt: '10' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.cancelled).toBe(10);
      expect(res._data.success_rate).toBe(0);
    });
  });

  // --- 失败原因分类 ---

  describe('失败原因分类', () => {
    it('CI 相关失败分类为 ci_failure', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'failed', failure_reason: 'CI failed on test step', cnt: '3' },
            { status: 'failed', failure_reason: 'github action timeout', cnt: '2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.failure_reasons.ci_failure).toBe(5);
    });

    it('Branch Protection 相关分类为 branch_protection', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'failed', failure_reason: 'branch protection rule prevented push', cnt: '4' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.failure_reasons.branch_protection).toBe(4);
    });

    it('/dev skill 相关分类为 dev_skill_error', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'failed', failure_reason: '/dev skill step 6 failed', cnt: '2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.failure_reasons.dev_skill_error).toBe(2);
    });

    it('无 failure_reason 分类为 other', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'failed', failure_reason: null, cnt: '7' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._data.failure_reasons.other).toBe(7);
    });
  });

  // --- 错误处理 ---

  describe('错误处理', () => {
    it('数据库查询失败返回 500', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection refused'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.error).toMatch(/Failed to query/);
      expect(res._data.details).toBe('connection refused');
    });
  });
});
