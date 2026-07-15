/**
 * Contract Test: relay-smoke executor 字段 — B6
 *
 * 本文件仅新增 B6 测试，不修改现有
 * packages/brain/src/routes/__tests__/relay-smoke.contract.test.js（B1~B5）。
 *
 * B6: 响应体含 executor 字段（非空字符串，值为 process.env.HARNESS_EXECUTOR || 'unknown'）
 *
 * 测试模式与现有 relay-smoke.contract.test.js 一致：
 * - vitest + supertest
 * - 通过 vi.mock 隔离外部依赖（pg-checkpointer、graph、db）
 * - 直接测试 express router，不依赖真实 Brain 服务器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock walking-skeleton.js 的外部依赖（与现有合同测试保持一致）
vi.mock('../../../packages/brain/src/routes/orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(),
}));

vi.mock('../../../packages/brain/src/routes/workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn(),
}));

vi.mock('../../../packages/brain/src/routes/db.js', () => ({
  default: { query: vi.fn() },
}));

// 动态 import walking-skeleton router（需要在 mock 之后）
const { default: walkingSkeletonRouter } = await import(
  '../../../packages/brain/src/routes/walking-skeleton.js'
);

/**
 * 构造最小 express app，与现有合同测试的 makeApp() 结构一致
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', walkingSkeletonRouter);
  return app;
}

describe('Contract: relay-smoke-executor-B6', () => {
  describe('GET /api/brain/relay-smoke — executor 字段（新增 B6）', () => {
    let originalEnv;

    beforeEach(() => {
      // 保存原始环境变量
      originalEnv = process.env.HARNESS_EXECUTOR;
    });

    afterEach(() => {
      // 恢复环境变量
      if (originalEnv === undefined) {
        delete process.env.HARNESS_EXECUTOR;
      } else {
        process.env.HARNESS_EXECUTOR = originalEnv;
      }
    });

    it('B6: 应返回 executor 字段且为非空字符串', async () => {
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.status).toBe(200);
      expect(res.body.executor).toBeDefined();
      expect(typeof res.body.executor).toBe('string');
      expect(res.body.executor.length).toBeGreaterThan(0);
    });

    it('B6-env: 应返回 HARNESS_EXECUTOR 环境变量值', async () => {
      process.env.HARNESS_EXECUTOR = 'claude';
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.status).toBe(200);
      expect(res.body.executor).toBe('claude');
    });

    it('B6-default: 未设置 HARNESS_EXECUTOR 时应返回 "unknown"', async () => {
      delete process.env.HARNESS_EXECUTOR;
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.status).toBe(200);
      expect(res.body.executor).toBe('unknown');
    });

    it('B6-coexist: executor 字段不影响 ok 和 controller 字段（B1~B3 回归）', async () => {
      const res = await request(makeApp()).get('/api/brain/relay-smoke');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.controller).toBe('2.2.0');
      expect(res.body.executor).toBeDefined();
    });
  });
});
