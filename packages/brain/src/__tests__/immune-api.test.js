/**
 * Tests for Immune System API
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../routes.js';
import pool from '../db.js';

// Mock pool.query
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

// Create test app
const app = express();
app.use(express.json());
app.use('/api/brain', router);

describe('Immune System API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/brain/policies', () => {
    it('返回策略列表', async () => {
      const now = new Date().toISOString();
      const mockPolicies = [
        {
          policy_id: 1,
          signature: 'error-network-timeout',
          status: 'active',
          policy_json: { action: 'requeue', params: {} },
          risk_level: 'low',
          success_count: 10,
          failure_count: 0,
          created_at: now,
          promoted_at: now
        }
      ];

      pool.query
        .mockResolvedValueOnce({ rows: mockPolicies })  // List query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });  // Count query

      const res = await request(app).get('/api/brain/policies');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockPolicies);
      expect(res.body.total).toBe(1);
    });

    it('支持 status 过滤', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });

      await request(app).get('/api/brain/policies?status=active');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = $1'),
        expect.arrayContaining(['active'])
      );
    });

    it('支持分页参数', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });

      await request(app).get('/api/brain/policies?limit=10&offset=20');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([10, 20])
      );
    });

    it('处理数据库错误', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app).get('/api/brain/policies');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to list policies');
    });
  });

  describe('GET /api/brain/policies/:id', () => {
    it('返回单个策略详情', async () => {
      const now = new Date().toISOString();
      const mockPolicy = {
        policy_id: 1,
        signature: 'error-network-timeout',
        status: 'active',
        policy_json: { action: 'requeue', params: {} },
        risk_level: 'low',
        success_count: 10,
        failure_count: 0
      };

      const mockEvals = [
        {
          eval_id: 1,
          task_id: 'task-1',
          mode: 'simulate',
          result: 'would_succeed',
          evaluated_at: now
        }
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [mockPolicy] })  // Policy query
        .mockResolvedValueOnce({ rows: mockEvals });    // Evaluations query

      const res = await request(app).get('/api/brain/policies/1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.policy_id).toBe(1);
      expect(res.body.data.evaluations).toEqual(mockEvals);
    });

    it('策略不存在返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/brain/policies/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Policy not found');
    });
  });

  describe('GET /api/brain/policies/:id/evaluations', () => {
    it('返回评估历史', async () => {
      const now = new Date().toISOString();
      const mockEvals = [
        {
          eval_id: 1,
          task_id: 'task-1',
          mode: 'simulate',
          result: 'would_succeed',
          evaluated_at: now
        }
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [{ policy_id: 1 }] })  // Policy check
        .mockResolvedValueOnce({ rows: mockEvals })           // Evaluations query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });    // Count query

      const res = await request(app).get('/api/brain/policies/1/evaluations');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockEvals);
      expect(res.body.total).toBe(1);
    });

    it('策略不存在返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/brain/policies/999/evaluations');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /api/brain/policies/:id/status', () => {
    it('更新策略状态', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ policy_id: 1 }] })  // Update query
        .mockResolvedValueOnce({});                             // Event log

      const res = await request(app)
        .patch('/api/brain/policies/1/status')
        .send({ status: 'disabled', reason: 'Manual disable' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('disabled');
    });

    it('验证状态枚举', async () => {
      const res = await request(app)
        .patch('/api/brain/policies/1/status')
        .send({ status: 'invalid_status' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid status');
    });

    it('缺少 status 参数返回 400', async () => {
      const res = await request(app)
        .patch('/api/brain/policies/1/status')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing required parameter: status');
    });

    it('策略不存在返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch('/api/brain/policies/999/status')
        .send({ status: 'disabled' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Policy not found');
    });
  });

  describe('GET /api/brain/failures/signatures', () => {
    it('返回失败签名统计', async () => {
      const now = new Date().toISOString();
      const mockSigs = [
        {
          signature: 'error-network-timeout',
          count: 45,
          first_seen: now,
          last_seen: now,
          active_policies: 2,
          probation_policies: 1
        }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockSigs });

      const res = await request(app).get('/api/brain/failures/signatures');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockSigs);
    });

    it('按 count 降序排序', async () => {
      const mockSigs = [
        { signature: 'sig-1', count: 100 },
        { signature: 'sig-2', count: 50 }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockSigs });

      const res = await request(app).get('/api/brain/failures/signatures');

      expect(res.body.data[0].count).toBeGreaterThan(res.body.data[1].count);
    });

    it('支持 limit 和 min_count 参数', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/brain/failures/signatures?limit=10&min_count=5');

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [5, 10]
      );
    });
  });

  describe('GET /api/brain/failures/signatures/:signature', () => {
    it('返回单个签名详情', async () => {
      const now = new Date().toISOString();
      const mockSig = {
        signature: 'error-network-timeout',
        count: 45,
        first_seen: now,
        last_seen: now
      };

      const mockPolicies = [
        { policy_id: 1, status: 'active', policy_json: {} }
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [mockSig] })       // Signature query
        .mockResolvedValueOnce({ rows: mockPolicies });   // Policies query

      const res = await request(app).get('/api/brain/failures/signatures/error-network-timeout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.signature).toBe('error-network-timeout');
      expect(res.body.data.policies).toEqual(mockPolicies);
    });

    it('签名不存在返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/brain/failures/signatures/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Signature not found');
    });
  });

  describe('GET /api/brain/policies/promotions', () => {
    it('返回晋升历史', async () => {
      const now = new Date().toISOString();
      const mockPromotions = [
        {
          policy_id: 1,
          signature: 'error-network-timeout',
          promoted_at: now,
          simulations: 5,
          pass_rate: 1.0,
          risk_level: 'low'
        }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockPromotions });

      const res = await request(app).get('/api/brain/policies/promotions');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockPromotions);
    });

    it('支持 days 参数', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/api/brain/policies/promotions?days=14');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INTERVAL \'14 days\''),
        expect.any(Array)
      );
    });

    it('包含 simulations 和 pass_rate', async () => {
      const mockPromotions = [
        {
          policy_id: 1,
          simulations: 5,
          pass_rate: 0.8
        }
      ];

      pool.query.mockResolvedValueOnce({ rows: mockPromotions });

      const res = await request(app).get('/api/brain/policies/promotions');

      expect(res.body.data[0]).toHaveProperty('simulations');
      expect(res.body.data[0]).toHaveProperty('pass_rate');
    });
  });

  describe('GET /api/brain/immune/dashboard', () => {
    it('返回策略统计', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [
          { status: 'active', count: '10' },
          { status: 'probation', count: '3' }
        ] })  // Policy stats
        .mockResolvedValueOnce({ rows: [{ total: 15 }] })  // Quarantine stats
        .mockResolvedValueOnce({ rows: [] })  // Top signatures
        .mockResolvedValueOnce({ rows: [] });  // Recent promotions

      const res = await request(app).get('/api/brain/immune/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.policies).toHaveProperty('active');
      expect(res.body.data.policies).toHaveProperty('total');
    });

    it('返回隔离区统计', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          total: '15',
          failure_threshold: '10',
          manual: '3',
          resource_hog: '2'
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/brain/immune/dashboard');

      expect(res.body.data.quarantine).toHaveProperty('total');
      expect(res.body.data.quarantine).toHaveProperty('by_reason');
    });

    it('返回 Top 10 失败签名', async () => {
      const mockSigs = [
        { signature: 'sig-1', count: 100 },
        { signature: 'sig-2', count: 50 }
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: mockSigs })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/brain/immune/dashboard');

      expect(res.body.data.failures.top_signatures).toEqual(mockSigs);
    });

    it('返回最近晋升记录', async () => {
      const now = new Date().toISOString();
      const mockPromotions = [
        { policy_id: 1, signature: 'sig-1', promoted_at: now }
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: mockPromotions });

      const res = await request(app).get('/api/brain/immune/dashboard');

      expect(res.body.data.recent_promotions).toEqual(mockPromotions);
    });
  });

  describe('Error Handling', () => {
    it('所有 API 返回统一格式', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const res = await request(app).get('/api/brain/policies');

      expect(res.body).toHaveProperty('success');
      expect(res.body).toHaveProperty('data');
    });

    it('数据库错误时返回 500', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await request(app).get('/api/brain/policies');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('details');
    });
  });
});
