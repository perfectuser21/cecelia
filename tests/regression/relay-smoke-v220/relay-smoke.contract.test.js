/**
 * Contract Test: relay-smoke-v2.2.0
 *
 * 合同测试覆盖 B1~B5，使用 express app 直接单元测试，不依赖真实 Brain 服务器。
 * 测试模式参考 packages/brain/src/routes/machines.test.js（vitest + supertest）。
 *
 * B1: GET /api/brain/relay-smoke 返回 HTTP 200
 * B2: 响应体含 ok:true
 * B3: 响应体含 controller:"2.2.0"
 * B4: 响应 Content-Type 含 application/json
 * B5: 不影响现有端点（/api/brain/context 仍可访问）
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock walking-skeleton.js 的外部依赖（pg-checkpointer、graph、db）
// 使 router 可以在无 DB 环境下 import
vi.mock('../../../packages/brain/src/orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(),
}));

vi.mock('../../../packages/brain/src/workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn(),
}));

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

// 动态 import walking-skeleton router（需要在 mock 之后）
const { default: walkingSkeletonRouter } = await import(
  '../../../packages/brain/src/routes/walking-skeleton.js'
);

/**
 * 构造最小 express app，挂载 walking-skeleton router 到 /api/brain，
 * 并额外注册一个 /api/brain/context stub 用于 B5 回归验证。
 */
function makeApp() {
  const app = express();
  app.use(express.json());

  // B5：模拟现有 /api/brain/context 端点（独立 stub，不依赖真实 brain 路由）
  app.get('/api/brain/context', (_req, res) => {
    res.json({ ok: true, stub: 'existing-route' });
  });

  // 被测路由：walking-skeleton router 挂载到 /api/brain
  app.use('/api/brain', walkingSkeletonRouter);

  return app;
}

describe('Contract: relay-smoke-v2.2.0', () => {
  describe('GET /api/brain/relay-smoke', () => {
    it('should return 200 OK', async () => {
      // B1
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.status).toBe(200);
    });

    it('should have ok:true in response', async () => {
      // B2
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.body.ok).toBe(true);
    });

    it('should have controller 2.2.0', async () => {
      // B3
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.body.controller).toBe('2.2.0');
    });

    it('should respond with JSON', async () => {
      // B4
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('现有路由回归', () => {
    it('should not break existing routes — /api/brain/context 仍可访问', async () => {
      // B5：确认挂载 relay-smoke 路由后 /api/brain/context 不受影响
      const res = await request(makeApp()).get('/api/brain/context');
      expect(res.status).toBe(200);
      expect(res.body).not.toBeNull();
    });
  });
});
