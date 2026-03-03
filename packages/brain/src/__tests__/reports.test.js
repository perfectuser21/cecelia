/**
 * reports.test.js — 系统简报 API 端点测试
 *
 * 测试 GET /api/brain/reports 和 GET /api/brain/reports/:id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 数据库
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

// 动态导入 (在 mock 之后)
const { default: router } = await import('../routes/reports.js');
import express from 'express';
import request from 'supertest';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/reports', router);
  return app;
}

describe('Reports API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/brain/reports', () => {
    it('返回空列表时响应 200 和空数组', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const app = createApp();
      const res = await request(app).get('/api/brain/reports');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.records).toEqual([]);
      expect(res.body.count).toBe(0);
    });

    it('返回简报列表（不含 content 字段）', async () => {
      const mockRows = [
        {
          id: 'test-id-1',
          type: '48h_briefing',
          created_at: '2026-03-04T06:00:00Z',
          metadata: { generated_by: 'manual_trigger', push_status: 'not_pushed' },
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: mockRows });

      const app = createApp();
      const res = await request(app).get('/api/brain/reports');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].id).toBe('test-id-1');
      expect(res.body.records[0].type).toBe('48h_briefing');
      // 列表不返回 content
      expect(res.body.records[0].content).toBeUndefined();
    });

    it('支持 ?limit= 参数', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const app = createApp();
      await request(app).get('/api/brain/reports?limit=5');

      // 验证查询参数传递
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([5])
      );
    });

    it('支持 ?type= 参数过滤', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const app = createApp();
      await request(app).get('/api/brain/reports?type=48h_briefing');

      // 验证带 type 过滤的查询
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE type'),
        expect.arrayContaining(['48h_briefing'])
      );
    });

    it('数据库异常时返回 500', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/brain/reports');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('GET /api/brain/reports/:id', () => {
    it('返回简报详情（含 content 字段）', async () => {
      const mockRow = {
        id: 'test-id-1',
        type: '48h_briefing',
        content: {
          summary: '测试简报',
          task_stats: { last_48h: { completed: 10 }, total: 10 },
          kr_progress: [],
          system_health: { brain: 'ok', database: 'ok' },
          anomalies: [],
          risks: [],
        },
        metadata: { generated_by: 'manual_trigger', push_status: 'not_pushed' },
        created_at: '2026-03-04T06:00:00Z',
      };
      mockQuery.mockResolvedValueOnce({ rows: [mockRow] });

      const app = createApp();
      const res = await request(app).get('/api/brain/reports/test-id-1');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.record.id).toBe('test-id-1');
      expect(res.body.record.content).toBeDefined();
      expect(res.body.record.content.task_stats).toBeDefined();
    });

    it('简报不存在时返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const app = createApp();
      const res = await request(app).get('/api/brain/reports/non-existent-id');

      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
    });

    it('数据库异常时返回 500', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/brain/reports/some-id');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /api/brain/reports/generate', () => {
    it('成功生成简报并返回记录', async () => {
      // 第一次查询：任务统计
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed', count: '5' }] });
      // 第二次查询：KR 进度
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'kr-1', title: 'KR 1', status: 'in_progress', progress: 60 }] });
      // 第三次查询：INSERT
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'new-report-id',
          type: '48h_briefing',
          created_at: '2026-03-04T06:00:00Z',
          metadata: { generated_by: 'manual_trigger', push_status: 'not_pushed' },
        }],
      });

      const app = createApp();
      const res = await request(app).post('/api/brain/reports/generate');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.message).toContain('成功');
      expect(res.body.record.id).toBe('new-report-id');
    });

    it('数据库异常时返回 500', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const app = createApp();
      const res = await request(app).post('/api/brain/reports/generate');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });
});
