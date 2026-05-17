/**
 * routes/walking-skeleton.test.js — LangGraph 修正 Sprint Stream 5
 *
 * 单元测试 walking-skeleton 路由：
 *   POST /api/brain/walking-skeleton-1node/trigger
 *   GET  /api/brain/walking-skeleton-1node/status/:threadId
 *
 * 用 supertest 起内存 express，mock db pool + checkpointer + graph 让 trigger
 * 不真跑 docker，status 不真查 PG。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pg-checkpointer
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({}),
}));

// Mock graph compile — getCompiledWalkingSkeleton 返回带 invoke 方法的 fake app
const mockInvoke = vi.fn();
vi.mock('../../workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn().mockResolvedValue({
    invoke: (...args) => mockInvoke(...args),
  }),
}));

// Mock db pool — status 端点查表
const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

import walkingSkeletonRouter from '../walking-skeleton.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', walkingSkeletonRouter);
  return app;
}

describe('routes/walking-skeleton (Stream 5)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ ok: true });
    mockQuery.mockReset();
  });

  describe('POST /api/brain/walking-skeleton-1node/trigger', () => {
    it('返回 200 + thread_id（UUID 格式）', async () => {
      const res = await request(makeApp())
        .post('/api/brain/walking-skeleton-1node/trigger')
        .send({})
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.thread_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('调 graph.invoke 时传正确 thread_id（fire-and-forget）', async () => {
      const res = await request(makeApp())
        .post('/api/brain/walking-skeleton-1node/trigger')
        .send({})
        .expect(200);
      // invoke 是 fire-and-forget，路由先 res.json 再 catch err，给 microtask 一拍
      await new Promise((r) => setImmediate(r));
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      const [stateInput, opts] = mockInvoke.mock.calls[0];
      expect(stateInput.triggerId).toBe(res.body.thread_id);
      expect(opts.configurable.thread_id).toBe(res.body.thread_id);
    });
  });

  describe('GET /api/brain/walking-skeleton-1node/status/:threadId', () => {
    it('thread 不存在 → 404 unknown', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(makeApp())
        .get('/api/brain/walking-skeleton-1node/status/no-such-thread')
        .expect(404);
      expect(res.body.status).toBe('unknown');
    });

    it('thread 存在 → 返回 row（status / container_id / result）', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          status: 'completed',
          container_id: 'walking-skeleton-abc12345',
          thread_id: 'tid-xyz',
          result: { result: 'hello' },
          created_at: '2026-05-08T08:00:00Z',
          resolved_at: '2026-05-08T08:00:05Z',
        }],
      });
      const res = await request(makeApp())
        .get('/api/brain/walking-skeleton-1node/status/tid-xyz')
        .expect(200);
      expect(res.body.status).toBe('completed');
      expect(res.body.container_id).toBe('walking-skeleton-abc12345');
      expect(res.body.result).toEqual({ result: 'hello' });
    });

    it('PG 抛错 → 500 + error message', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));
      const res = await request(makeApp())
        .get('/api/brain/walking-skeleton-1node/status/anything')
        .expect(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('connection refused');
    });
  });
});
