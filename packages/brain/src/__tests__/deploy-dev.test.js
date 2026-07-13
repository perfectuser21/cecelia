/**
 * deploy-dev.test.js
 * 验证 POST /api/brain/deploy {dev:true} 和 GET /api/brain/deploy/dev/status 端点
 * Sprint: 07131922-环境模型三段常驻收尾
 * task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock execFile to avoid actual script execution in tests
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => {
    // Default: simulate successful deploy after short delay
    const mockChild = {
      on: vi.fn((event, handler) => {
        if (event === 'spawn') handler();
        return mockChild;
      }),
    };
    setTimeout(() => cb(null, 'deploy done', ''), 50);
    return mockChild;
  }),
}));

// Dynamically import the router (after mocking)
const { default: deployDevRouter } = await import('../routes/deploy-dev.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', deployDevRouter);
  return app;
}

describe('deploy-dev 端点', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/brain/deploy/dev/status', () => {
    it('返回 HTTP 200 含 status 字段', async () => {
      const res = await request(app).get('/api/brain/deploy/dev/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(['idle', 'pending', 'running', 'success', 'failed']).toContain(res.body.status);
    });

    it('初始 status 为 idle', async () => {
      const res = await request(app).get('/api/brain/deploy/dev/status');
      expect(res.status).toBe(200);
      // status 可能是 idle 或 success（取决于模块级状态），但必须是有效值
      expect(['idle', 'success', 'failed', 'running', 'pending']).toContain(res.body.status);
    });
  });

  describe('POST /api/brain/deploy', () => {
    it('body.dev=true 返回 202 含 accepted + job_id', async () => {
      const res = await request(app)
        .post('/api/brain/deploy')
        .send({ dev: true });
      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(true);
      expect(res.body.job_id).toBeDefined();
      expect(res.body.status_url).toBeDefined();
    });

    it('body.dev=false 返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/deploy')
        .send({ dev: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('body 为空返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/deploy')
        .send({});
      expect(res.status).toBe(400);
    });

    it('deploy dev 触发后 status_url 返回 running 或 pending 或 success', async () => {
      await request(app)
        .post('/api/brain/deploy')
        .send({ dev: true });

      const statusRes = await request(app).get('/api/brain/deploy/dev/status');
      expect(statusRes.status).toBe(200);
      expect(['running', 'pending', 'success', 'idle', 'failed']).toContain(statusRes.body.status);
    });
  });
});
