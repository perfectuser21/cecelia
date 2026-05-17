/**
 * System Reports API Route Tests
 * GET /api/brain/reports
 * GET /api/brain/reports/:id
 * POST /api/brain/reports/generate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool };
});

import pool from '../db.js';
import systemReportsRoutes from '../routes/system-reports.js';

function mockReqRes(params = {}, query = {}, body = {}) {
  const req = { params, query, body };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

// 获取路由 handler
function getHandler(routes, method, path) {
  const layer = routes.stack?.find(
    l => l.route?.path === path && l.route?.methods?.[method.toLowerCase()]
  );
  return layer?.route?.stack?.[0]?.handle;
}

describe('System Reports API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET / - 简报列表', () => {
    it('返回 reports、count、total 字段', async () => {
      const mockReports = [
        {
          id: 'uuid-1',
          type: '48h_system_report',
          title: '测试简报',
          summary: '摘要内容',
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ];

      // mock: [rows, countRows]
      pool.query
        .mockResolvedValueOnce({ rows: mockReports })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const { req, res } = mockReqRes({}, {});
      const handler = getHandler(systemReportsRoutes, 'get', '/');
      expect(handler).toBeDefined();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toHaveProperty('reports');
      expect(res._data).toHaveProperty('count');
      expect(res._data).toHaveProperty('total');
      expect(res._data.total).toBe(5);
      expect(res._data.reports).toHaveLength(1);
      expect(res._data.reports[0].title).toBe('测试简报');
    });

    it('支持 limit/offset 分页参数', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const { req, res } = mockReqRes({}, { limit: '10', offset: '20' });
      const handler = getHandler(systemReportsRoutes, 'get', '/');
      await handler(req, res);

      expect(res._data.limit).toBe(10);
      expect(res._data.offset).toBe(20);
    });

    it('空列表时返回 total=0', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const { req, res } = mockReqRes({}, {});
      const handler = getHandler(systemReportsRoutes, 'get', '/');
      await handler(req, res);

      expect(res._data.reports).toHaveLength(0);
      expect(res._data.total).toBe(0);
    });

    it('数据库错误时返回 500', async () => {
      pool.query.mockRejectedValue(new Error('DB connection failed'));

      const { req, res } = mockReqRes({}, {});
      const handler = getHandler(systemReportsRoutes, 'get', '/');
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data).toHaveProperty('error');
    });
  });

  describe('GET /:id - 简报详情', () => {
    it('返回完整 report（含 content）', async () => {
      const mockReport = {
        id: 'uuid-1',
        type: '48h_system_report',
        content: { title: '测试', summary: '摘要', task_stats: { completed: 5 } },
        metadata: {},
        created_at: new Date().toISOString(),
      };

      pool.query.mockResolvedValue({ rows: [mockReport] });

      const { req, res } = mockReqRes({ id: 'uuid-1' }, {});
      const handler = getHandler(systemReportsRoutes, 'get', '/:id');
      expect(handler).toBeDefined();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toHaveProperty('report');
      expect(res._data.report.id).toBe('uuid-1');
      expect(res._data.report.content.task_stats.completed).toBe(5);
    });

    it('不存在的 ID 返回 404', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const { req, res } = mockReqRes({ id: 'non-existent' }, {});
      const handler = getHandler(systemReportsRoutes, 'get', '/:id');
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data).toHaveProperty('error');
    });
  });

  describe('POST /generate - 手动生成简报', () => {
    it('成功创建简报并返回', async () => {
      const newReport = {
        id: 'new-uuid',
        type: '48h_summary',
        metadata: { triggered_by: 'api' },
        created_at: new Date().toISOString(),
      };

      pool.query.mockResolvedValue({ rows: [newReport] });

      const { req, res } = mockReqRes({}, {}, { type: '48h_summary' });
      const handler = getHandler(systemReportsRoutes, 'post', '/generate');
      expect(handler).toBeDefined();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.report.id).toBe('new-uuid');
    });

    it('默认类型为 48h_summary', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 'uuid', type: '48h_summary', metadata: {}, created_at: new Date().toISOString() }]
      });

      const { req, res } = mockReqRes({}, {}, {});
      const handler = getHandler(systemReportsRoutes, 'post', '/generate');
      await handler(req, res);

      // 检查 SQL 传入的第一个参数是默认 type
      const callArgs = pool.query.mock.calls[0];
      expect(callArgs[1][0]).toBe('48h_summary');
    });
  });
});
