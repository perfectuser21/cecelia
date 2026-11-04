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
 * B5: 未匹配context路径能继续到后续哨兵
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock walking-skeleton.js 的外部依赖（pg-checkpointer、graph、db）
// 使 router 可以在无 DB 环境下 import
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(),
}));

vi.mock('../workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn(),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// 动态 import walking-skeleton router（需要在 mock 之后）
const { default: walkingSkeletonRouter } = await import(
  '../walking-skeleton.js'
);

/**
 * 构造最小 express app，挂载 walking-skeleton router 到 /api/brain，
 * 并额外注册一个 /api/brain/context stub 用于 B5 回归验证。
 */
const enteredRouter = vi.fn();
function makeApp() {
  const app = express();
  app.use(express.json());

  // 被测router在前，后续哨兵用于核未匹配路由能继续next。
  app.use('/api/brain', (_req, _res, next) => { enteredRouter(); next(); }, walkingSkeletonRouter);
  app.get('/api/brain/context', (_req, res) => {
    res.json({ ok: true, stub: 'existing-route' });
  });

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
    it('未匹配context路径穿过router到达后续哨兵', async () => {
      enteredRouter.mockClear();
      // B5：确认请求经过被测router后仍能抵达后续哨兵
      const res = await request(makeApp()).get('/api/brain/context');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, stub: 'existing-route' });
      expect(enteredRouter).toHaveBeenCalledOnce();
    });
  });
});
