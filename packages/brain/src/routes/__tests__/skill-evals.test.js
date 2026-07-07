/**
 * skill-evals 路由单元测试
 * 覆盖：Token 验证 403、硬校验拒绝 400、成功上传 201、状态查询 200
 */

import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSkillEvalRouter, getSkillEvalConfigHandler } from '../skill-evals.js';

// ── mock DB ──────────────────────────────────────────────────────────────────
function makeDb(overrides = {}) {
  const store = [];
  return {
    _store: store,
    oneOrNone: vi.fn(async (sql, vals) => {
      if (overrides.oneOrNone) return overrides.oneOrNone(sql, vals);
      return null;
    }),
    one: vi.fn(async (sql, vals) => {
      if (overrides.one) return overrides.one(sql, vals);
      return { pending_count: '0', queue_pos: '0', running_count: '0' };
    }),
    none: vi.fn(async () => null),
    manyOrNone: vi.fn(async () => overrides.rows || []),
  };
}

// ── minimal valid zip buffer (contains SKILL.md) ─────────────────────────────
const VALID_ZIP_B64 =
  'UEsDBAoAAAAIAH2N51whw5CgNQAAADQAAAAIAAAAU0tJTEwubWRTVgjOzszJ4eIKTk1NsVJISU1LLM0p4eJSVlZ42jX/RfPeZ/39L/Zv4Hq2tfvF+qkKxSDFAFBLAwQKAAAACAB9jedcMz558RYAAAAUAAAACQAAAFJFQURNRS5tZFNWCEktLlEIzs7MyVEISEzOTkxPBQBQSwMECgAAAAAAfY3nXAAAAAAAAAAAAAAAAAQAAABzcmMvUEsDBAoAAAAIAH2N51xEheZqHQAAABsAAAAMAAAAc3JjL2luZGV4LmpzS87PK87PSdXLyU/XUMpIzcnJVyjOzszJUdK0BgBQSwECFAAKAAAACAB9jedcIcOQoDUAAAA0AAAACAAAAAAAAAAAAAAAAAAAAAAAU0tJTEwubWRQSwECFAAKAAAACAB9jedcMz558RYAAAAUAAAACQAAAAAAAAAAAAAAAABbAAAAUkVBRE1FLm1kUEsBAhQACgAAAAAAfY3nXAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAQAAAAmAAAAHNyYy9QSwECFAAKAAAACAB9jedcRIXmah0AAAAbAAAADAAAAAAAAAAAAAAAAAC6AAAAc3JjL2luZGV4LmpzUEsFBgAAAAAEAAQA2QAAAAEBAAAAAA==';

function validZipBuffer() {
  return Buffer.from(VALID_ZIP_B64, 'base64');
}

function makeApp(db, env = {}) {
  // 设置环境变量（测试 token）
  process.env.SKILL_EVAL_PROXY_TOKEN = env.token || 'test-token';
  process.env.MAX_ZIP_MB = String(env.MAX_ZIP_MB ?? 10);
  process.env.SKILL_EVAL_PENDING_LIMIT = String(env.pendingLimit || 20);
  process.env.MAX_CONCURRENT_SKILL_EVAL = '1';

  const app = express();
  app.use(express.json());
  app.use('/api/brain/skill-evals', createSkillEvalRouter({ db }));
  app.get('/api/brain/config', getSkillEvalConfigHandler());
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    return res.status(400).json({ error: err.message || 'Bad Request' });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('skill-evals 路由', () => {
  describe('Token 验证', () => {
    it('无 token 时 POST /upload 返回 403', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .attach('file', validZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Unauthorized/i);
    });

    it('错误 token 返回 403', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'wrong-token')
        .attach('file', validZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });
      expect(res.status).toBe(403);
    });
  });

  describe('硬校验', () => {
    it('上传非 zip 文件（错误魔数）返回 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const fakeBuffer = Buffer.from('this is not a zip file at all');
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'test-token')
        .attach('file', fakeBuffer, { filename: 'bad.zip', contentType: 'application/zip' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/magic bytes/i);
    });

    it('超过 MAX_ZIP_MB 限制返回 400', async () => {
      const db = makeDb();
      // 设置极小限制（1 byte）
      process.env.MAX_ZIP_MB = '0';
      const app = makeApp(db, { MAX_ZIP_MB: 0 });
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'test-token')
        .attach('file', validZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/MAX_ZIP_MB/i);
      process.env.MAX_ZIP_MB = '10';
    });

    it('无文件上传返回 400', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'test-token')
        .set('Content-Type', 'multipart/form-data');
      expect(res.status).toBe(400);
    });
  });

  describe('成功上传', () => {
    it('合法 zip 上传返回 201 + task_id', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'test-token')
        .field('skill_name', 'test-skill')
        .field('platform', 'linux')
        .attach('file', validZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });
      expect(res.status).toBe(201);
      expect(res.body.task_id).toBeTruthy();
      expect(typeof res.body.position).toBe('number');
    });

    it('重复 hash（已完成任务）返回 200 + report_url', async () => {
      const db = makeDb({
        oneOrNone: async () => ({
          task_id: 'existing-id',
          status: 'completed',
          report_url: 'https://example.com/report',
        }),
      });
      const app = makeApp(db);
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'test-token')
        .attach('file', validZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('duplicate');
      expect(res.body.report_url).toBe('https://example.com/report');
    });

    it('背压满（pending 达上限）返回 429', async () => {
      const db = makeDb({
        one: async () => ({ pending_count: '20', queue_pos: '20', running_count: '0' }),
      });
      const app = makeApp(db, { pendingLimit: 20 });
      const res = await request(app)
        .post('/api/brain/skill-evals/upload')
        .set('x-eval-proxy-token', 'test-token')
        .attach('file', validZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });
      expect(res.status).toBe(429);
    });
  });

  describe('状态查询', () => {
    it('GET /:task_id/status 存在时返回 200 + 任务信息', async () => {
      const taskRow = {
        task_id: 'abc-123',
        status: 'pending',
        skill_name: 'my-skill',
        platform: 'linux',
        report_url: null,
        failure_reason: null,
        pending_reason: null,
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
      };
      const db = makeDb({ oneOrNone: async () => taskRow });
      const app = makeApp(db);
      const res = await request(app).get('/api/brain/skill-evals/abc-123/status');
      expect(res.status).toBe(200);
      expect(res.body.task_id).toBe('abc-123');
      expect(res.body.status).toBe('pending');
    });

    it('GET /:task_id/status 不存在时返回 404', async () => {
      const db = makeDb({ oneOrNone: async () => null });
      const app = makeApp(db);
      const res = await request(app).get('/api/brain/skill-evals/nonexistent/status');
      expect(res.status).toBe(404);
    });

    it('GET /list 返回 200 + 数组', async () => {
      const db = makeDb({ rows: [{ task_id: 't1', status: 'pending', skill_name: 's1' }] });
      const app = makeApp(db);
      const res = await request(app).get('/api/brain/skill-evals/list');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/brain/config 返回配置对象', async () => {
      const db = makeDb();
      const app = makeApp(db);
      const res = await request(app).get('/api/brain/config');
      expect(res.status).toBe(200);
      expect(res.body.MAX_ZIP_MB).toBeDefined();
      expect(res.body.SKILL_EVAL_PENDING_LIMIT).toBeDefined();
    });
  });
});
