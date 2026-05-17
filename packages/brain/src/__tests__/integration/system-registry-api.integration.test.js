/**
 * Integration Test: system_registry API — 封堵孤岛 Day3-4
 *
 * 验证 /api/brain/registry 路由的完整 CRUD 流程和过滤功能。
 * 测试粒度：路由层 + 逻辑层集成（mock DB pool，不连真实 PostgreSQL）。
 *
 * 相关功能：docs/instruction-book/features/dev-registration-gate.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pool
vi.mock('../../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../../db.js';
import registryRouter from '../../routes/registry.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/registry', registryRouter);
  return app;
}

const SAMPLE_ENTRY = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  type: 'skill',
  name: '/dev',
  location: 'packages/engine/skills/dev/SKILL.md',
  description: '统一开发工作流入口（4-Stage Pipeline）',
  status: 'active',
  depends_on: [],
  metadata: { trigger: ['/dev', '改代码'] },
  created_at: '2026-03-28T00:00:00Z',
  updated_at: '2026-03-28T00:00:00Z',
};

describe('System Registry API — Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET / — 列表查询 ───────────────────────────────────────────────

  describe('GET /api/brain/registry', () => {
    it('返回所有 active 条目（默认排除 deprecated）', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ENTRY] });
      const res = await request(makeApp()).get('/api/brain/registry');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].name).toBe('/dev');
    });

    it('支持 type=skill 过滤', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ENTRY] });
      const res = await request(makeApp()).get('/api/brain/registry?type=skill');
      expect(res.status).toBe(200);
      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('AND type =');
      expect(call[1]).toContain('skill');
    });

    it('支持 status 过滤', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(makeApp()).get('/api/brain/registry?status=deprecated');
      expect(res.status).toBe(200);
      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('AND status =');
    });

    it('支持 search 模糊搜索', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ENTRY] });
      const res = await request(makeApp()).get('/api/brain/registry?search=dev');
      expect(res.status).toBe(200);
      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('ILIKE');
    });

    it('DB 异常时返回 500', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection refused'));
      const res = await request(makeApp()).get('/api/brain/registry');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  // ─── GET /exists — 查重 ─────────────────────────────────────────────

  describe('GET /api/brain/registry/exists', () => {
    it('条目存在时返回 exists:true 和 item', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ENTRY] });
      const res = await request(makeApp())
        .get('/api/brain/registry/exists?type=skill&name=/dev');
      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
      expect(res.body.item).toBeDefined();
      expect(res.body.item.name).toBe('/dev');
    });

    it('条目不存在时返回 exists:false', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(makeApp())
        .get('/api/brain/registry/exists?type=skill&name=/nonexistent');
      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(false);
    });

    it('缺少 type 参数时返回 400', async () => {
      const res = await request(makeApp())
        .get('/api/brain/registry/exists?name=/dev');
      expect(res.status).toBe(400);
    });

    it('缺少 name 参数时返回 400', async () => {
      const res = await request(makeApp())
        .get('/api/brain/registry/exists?type=skill');
      expect(res.status).toBe(400);
    });
  });

  // ─── POST / — 创建条目 ──────────────────────────────────────────────

  describe('POST /api/brain/registry', () => {
    it('成功创建新条目', async () => {
      const newEntry = { ...SAMPLE_ENTRY, id: 'new-id-001', name: '/new-skill' };
      pool.query.mockResolvedValueOnce({ rows: [newEntry] });
      const res = await request(makeApp())
        .post('/api/brain/registry')
        .send({
          type: 'skill',
          name: '/new-skill',
          description: '新技能',
        });
      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
    });

    it('缺少必填字段时返回 400', async () => {
      const res = await request(makeApp())
        .post('/api/brain/registry')
        .send({ type: 'skill' }); // 缺 name
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /:id — 更新条目 ──────────────────────────────────────────

  describe('PATCH /api/brain/registry/:id', () => {
    it('成功更新条目状态', async () => {
      const updated = { ...SAMPLE_ENTRY, status: 'deprecated' };
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      const res = await request(makeApp())
        .patch(`/api/brain/registry/${SAMPLE_ENTRY.id}`)
        .send({ status: 'deprecated' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('deprecated');
    });

    it('条目不存在时返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(makeApp())
        .patch('/api/brain/registry/nonexistent-id')
        .send({ status: 'deprecated' });
      expect(res.status).toBe(404);
    });
  });
});
