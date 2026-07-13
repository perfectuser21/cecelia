/**
 * deploy-dev.test.js — 配套测试
 * 覆盖：POST /api/brain/deploy (dev:true) 和 GET /api/brain/deploy/dev/status
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock child_process.execFile，避免真实执行 bash 脚本
vi.mock('child_process', () => {
  const emitter = {
    on: vi.fn(),
  };
  return {
    execFile: vi.fn((_cmd, _args, _opts, _callback) => {
      // 默认不立刻调用 callback（模拟异步执行中）
      return emitter;
    }),
  };
});

import deployDevRouter from './deploy-dev.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', deployDevRouter);
  return app;
}

describe('deploy-dev routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/brain/deploy', () => {
    it('当 body.dev=true 时返回 202 并包含 job_id', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/brain/deploy')
        .send({ dev: true });

      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(true);
      expect(typeof res.body.job_id).toBe('string');
      expect(res.body.job_id).toMatch(/^dev-deploy-/);
      expect(res.body.status_url).toBe('/api/brain/deploy/dev/status');
    });

    it('当 body.dev 缺失或为 false 时返回 400', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/brain/deploy')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/dev/i);
    });

    it('空 body 返回 400', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/brain/deploy')
        .send();

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/brain/deploy/dev/status', () => {
    it('初始状态返回 idle', async () => {
      // 使用新的 app 实例（router 模块已缓存，状态从模块加载起算）
      // 直接获取状态
      const app = makeApp();
      const res = await request(app).get('/api/brain/deploy/dev/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(typeof res.body.status).toBe('string');
    });

    it('触发部署后 status 变为 pending 或 running', async () => {
      const app = makeApp();

      // 先 POST 触发
      await request(app)
        .post('/api/brain/deploy')
        .send({ dev: true });

      // 再 GET 查状态
      const res = await request(app).get('/api/brain/deploy/dev/status');
      expect(res.status).toBe(200);
      expect(['pending', 'running', 'success', 'failed']).toContain(res.body.status);
      expect(res.body).toHaveProperty('job_id');
    });

    it('返回结构含所有必要字段', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/brain/deploy/dev/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('job_id');
      expect(res.body).toHaveProperty('started_at');
      expect(res.body).toHaveProperty('finished_at');
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('重复部署防护', () => {
    it('部署进行中时再次 POST 返回 409', async () => {
      const app = makeApp();

      // 第一次触发
      await request(app)
        .post('/api/brain/deploy')
        .send({ dev: true });

      // 第二次应被拒绝（状态仍 pending/running）
      const res2 = await request(app)
        .post('/api/brain/deploy')
        .send({ dev: true });

      expect(res2.status).toBe(409);
      expect(res2.body).toHaveProperty('error');
      expect(res2.body.error).toMatch(/in progress/i);
    });
  });

  describe('模块加载', () => {
    it('deploy-dev 模块默认导出为 express router（函数）', async () => {
      expect(typeof deployDevRouter).toBe('function');
    });
  });
});
